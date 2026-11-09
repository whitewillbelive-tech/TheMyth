import { mountAtlas } from "/atlas-view.js";
import { generations as catalogGenerations, titlesForGeneration, generationForTitle, appearancesFor, appearanceFor, commonProfile, resolveTitleProfile, PROFILE_FIELDS, titleIdsForEntity, eventRelationWarnings, profileTimelineWarnings, catalogStatus } from "/main-domain.js";
import { normalizeMainContext, mainSection, contextForEntity, scopedEntities, withSpaceAncestors, detachedAppearances, hasAppearanceContent, scopedGroups, captureFormFields, restoreFormFields, titleSettingsPayload, appearanceSelectionPayload, timelineParameters } from "/main-view-model.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const h = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const names = {
  generation: "세대",
  title: "타이틀",
  character: "인물",
  organization: "집단·조직",
  event: "사건",
  space: "우주 공간",
  planet: "행성",
  civilization: "문명",
  setting: "세계관 설정",
  thought: "사상",
  thinker: "사상가",
  custom: "사용자 분류",
};
const relNames = {
  appearance: "작품 등장",
  membership: "집단 소속",
  galaxy_master: "갤럭시 마스터",
  governs: "통치·조율",
  related: "관련",
  before: "이전 사건",
  after: "이후 사건",
  causes: "원인 → 결과",
  caused_by: "결과 ← 원인",
  founder: "창시",
  inherits: "계승",
  develops: "발전",
  criticizes: "비판",
  accepts: "수용",
  rejects: "거부",
  uses: "사용·전승",
  located_in: "활동 공간",
  participates: "사건 참여",
  author: "저술",
};
const mainNav = [
  ["character", "♙", "인물"],
  ["event", "◇", "사건"],
  ["background", "◎", "배경"],
];
const writeNav = [
  ["story", "✎", "외전 창작실"],
  ["book", "▥", "사상집 집필실"],
  ["thought", "◈", "사상 아카이브"],
  ["thinker", "♙", "사상가"],
];
let db = {
  entities: [],
  relations: [],
  groups: [],
  memberships: [],
  states: [],
  documents: [],
  chapters: [],
  versions: [],
};
let prefs;
try {
  prefs = JSON.parse(localStorage.getItem("myth-ui") || "{}");
} catch {
  prefs = {};
}
let ui = {
  tab: "main",
  view: "character",
  query: "",
  kind: "",
  title: "",
  group: "",
  selected: null,
  chapter: null,
  mainGeneration: "",
  mainTitle: null,
  includeCommon: true,
  backgroundOpen: false,
  characterSlots: {},
  ...prefs,
};
if (ui.tab === "main" && ui.view === "overview") ui.view = "character";
let saveStatus = "모든 변경사항 저장됨";
let disposeAtlas;
let documentTimer,
  pendingWrite = Promise.resolve(),
  toastTimer;
let localDrafts;
try {
  localDrafts = JSON.parse(localStorage.getItem("myth-drafts") || "{}");
} catch {
  localDrafts = {};
}
const active = (collection) =>
  (db[collection] || []).filter((x) => !x.deleted_at);
const lookup = (id) =>
  db.entities.find((x) => x.id === id) ||
  db.documents.find((x) => x.id === id) ||
  db.groups.find((x) => x.id === id);
const label = (id) =>
  lookup(id)?.name || (id ? "삭제되거나 연결 해제된 자료" : "미정");
const sorted = (list) =>
  [...list].sort(
    (a, b) =>
      (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
      (a.name || "").localeCompare(b.name || "", "ko"),
  );
function persist() {
  try {
    localStorage.setItem("myth-ui", JSON.stringify(ui));
  } catch {}
}
function draftsPersist() {
  try {
    localStorage.setItem("myth-drafts", JSON.stringify(localDrafts));
  } catch {
    toast(
      "이 브라우저의 임시 저장 공간이 부족합니다. 서버 저장 상태를 확인하세요.",
    );
  }
}
function toast(message, error = false) {
  const t = $("#toast");
  t.textContent = message;
  t.classList.toggle("error", error);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 6000);
}
function setStatus(s) {
  saveStatus = s;
  const el = $(".save-state");
  if (el) {
    el.textContent = s;
    el.classList.toggle("dirty", s.includes("미저장") || s.includes("실패"));
  }
}
async function api(path, method = "GET", body) {
  const res = await fetch("/api" + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let e;
    try {
      e = await res.json();
    } catch {}
    throw new Error(
      typeof e?.detail === "string"
        ? e.detail
        : JSON.stringify(e?.detail || e || `요청 실패 (${res.status})`),
    );
  }
  return res.status === 204 ? null : res.json();
}
async function refresh(renderPage = true) {
  db = await api("/state");
  if (renderPage) render();
}
async function mutate(path, method = "POST", body, message = "저장했습니다.") {
  const result = await api(path, method, body);
  await refresh();
  if (message) toast(message);
  return result;
}
function safe(fn) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (e) {
      toast(e.message, true);
      setStatus("저장 실패 · 임시 내용 보존됨");
      console.error(e);
    }
  };
}
function option(value, text, selected) {
  return `<option value="${h(value)}" ${String(value) === String(selected) ? "selected" : ""}>${h(text)}</option>`;
}
function options(list, selected, empty = "선택하지 않음") {
  return (
    option("", empty, selected) +
    sorted(list)
      .map((e) => option(e.id, e.name, selected))
      .join("")
  );
}
function button(text, action, id = "", cls = "") {
  return `<button type="button" class="button ${cls}" data-action="${action}" data-id="${h(id)}">${text}</button>`;
}
function tag(text, cls = "") {
  return `<span class="tag ${cls}">${h(text)}</span>`;
}
function field(labelText, content, wide = false) {
  const accessibleLabel = h(labelText.replace(/<[^>]*>/g, ""));
  const control = content.replace(
    /<(input|textarea|select)\b/,
    `<$1 aria-label="${accessibleLabel}"`,
  );
  return `<label class="field ${wide ? "wide" : ""}"><span>${labelText}</span>${control}</label>`;
}
function input(name, value = "", placeholder = "", extra = "") {
  return `<input name="${name}" value="${h(value)}" placeholder="${h(placeholder)}" ${extra}>`;
}
function textarea(name, value = "", placeholder = "", rows = 4) {
  return `<textarea name="${name}" rows="${rows}" placeholder="${h(placeholder)}">${h(value)}</textarea>`;
}
function timeLabel(t) {
  if (!t || t.mode === "unknown") return t?.label || "연도 미확정";
  if (t.mode === "absolute") return `절대 연도 ${t.year}`;
  if (t.mode === "range") return `${t.start ?? "미정"} – ${t.end ?? "미정"}`;
  return `${label(t.event_id)} ${t.mode === "before" ? "이전" : "이후"}`;
}
function date(s) {
  return s ? new Date(s).toLocaleString("ko-KR") : "";
}
function timeFields(prefix, t = {}) {
  return `<div class="time-fields form-grid">${field(
    "시간 표현",
    `<select name="${prefix}_mode">${[
      ["unknown", "미확정"],
      ["absolute", "우주 절대 연도"],
      ["range", "기간"],
      ["before", "사건 이전"],
      ["after", "사건 이후"],
    ]
      .map(([v, l]) => option(v, l, t?.mode || "unknown"))
      .join("")}</select>`,
  )}${field("절대 연도", input(prefix + "_year", t?.year ?? "", "미확정이면 비워두세요", 'type="number" step="any"'))}${field("기간 시작", input(prefix + "_start", t?.start ?? "", "", 'type="number" step="any"'))}${field("기간 종료", input(prefix + "_end", t?.end ?? "", "", 'type="number" step="any"'))}${field(
    "기준 사건",
    `<select name="${prefix}_event_id">${options(
      active("entities").filter((x) => x.kind === "event"),
      t?.event_id,
      "기준 사건 선택",
    )}</select>`,
  )}${field("시간 메모", input(prefix + "_label", t?.label || "", "예: 전쟁이 끝난 뒤"))}</div>`;
}
function readTime(fd, p) {
  const mode = fd.get(p + "_mode") || "unknown";
  const num = (k) =>
    fd.get(p + "_" + k) === "" ? null : Number(fd.get(p + "_" + k));
  return {
    mode,
    year: mode === "absolute" ? num("year") : null,
    start: mode === "range" ? num("start") : null,
    end: mode === "range" ? num("end") : null,
    event_id: ["before", "after"].includes(mode)
      ? fd.get(p + "_event_id") || null
      : null,
    label: fd.get(p + "_label") || "",
  };
}
function mainContext() {
  return { generationId: ui.mainGeneration, titleId: ui.mainTitle, includeCommon: ui.includeCommon };
}
function setMainContext(context) {
  ui.mainGeneration = context.generationId;
  ui.mainTitle = context.titleId;
  ui.includeCommon = context.includeCommon !== false;
}
function mainNavigation() {
  const section = mainSection(ui.view);
  return mainNav.map(([view, icon, name]) => view === "background"
    ? `<button type="button" data-action="toggle-background" aria-expanded="${!!ui.backgroundOpen}" aria-controls="background-navigation" class="${section === view ? "active" : ""}"><span class="nav-icon">${icon}</span>${name}<span class="nav-chevron">${ui.backgroundOpen ? "⌃" : "⌄"}</span></button><div id="background-navigation" class="background-navigation" ${ui.backgroundOpen ? "" : "hidden"}>${[["spaces","우주 공간"],["setting","세계관 설정"],["timeline","통합 연대기"]].map(([id,label])=>`<button type="button" data-action="view" data-id="${id}" class="${ui.view === id || id === "spaces" && ui.view === "atlas" ? "active" : ""}">${label}</button>`).join("")}</div>`
    : `<button type="button" data-action="view" data-id="${view}" class="${section === view ? "active" : ""}"><span class="nav-icon">${icon}</span>${name}</button>`).join("");
}
function commonSelection() {
  const gens = catalogGenerations(db), titles = titlesForGeneration(db, ui.mainGeneration), status = catalogStatus(db);
  return `<section class="main-context" aria-label="본편 세대와 서브타이틀"><div class="main-context-top"><div class="generation-tabs" role="tablist" aria-label="세대">${gens.map(g=>`<button type="button" role="tab" aria-selected="${g.id === ui.mainGeneration}" data-action="select-generation" data-id="${g.id}"><strong>${h(g.data?.number || "")}세대</strong><span>${h(g.name)}</span></button>`).join("") || '<span class="muted">아직 등록된 세대가 없습니다.</span>'}</div>${button("세대·타이틀 관리", "view", "generations", "ghost small")}</div><div class="main-context-bottom"><label class="context-title"><span>서브타이틀</span><select id="main-title-select" aria-label="서브타이틀">${titles.length ? option("", "이 세대의 모든 타이틀", ui.mainTitle) + titles.map(t=>option(t.id,t.name,ui.mainTitle)).join("") : '<option value="">미정 · 확정된 타이틀 없음</option>'}</select></label>${["spaces","setting","timeline","atlas","organization","civilization","groups"].includes(ui.view) ? `<label class="context-common"><input id="main-common-toggle" type="checkbox" ${ui.includeCommon ? "checked" : ""}> 연결되지 않은 공통 자료도 보기</label>` : ""}<span class="context-note">선택은 본편 화면을 이동해도 유지됩니다.</span></div>${status.needsSetup ? `<div class="catalog-setup"><p>세대와 작품 목록을 준비할 수 있습니다. 기존 자료와 사용자 타이틀은 보존됩니다.</p>${button("초기 세대·타이틀 등록", "setup-catalog", "", "small primary")}</div>` : ""}${status.conflicts?.length ? `<p class="conflict">${status.conflicts.map(h).join("<br>")}</p>` : ""}</section>`;
}
function peopleNavigation() {
  if (ui.tab !== "main" || !["character","organization","civilization","groups"].includes(ui.view)) return "";
  const collective = ui.view !== "character";
  return `<nav class="main-section-tabs" aria-label="인물 작업 영역">${button("인물 목록", "view", "character", !collective ? "active" : "ghost")}${button("집단·문명·그룹", "view", collective ? ui.view : "organization", collective ? "active" : "ghost")}</nav>${collective ? `<nav class="collective-tabs" aria-label="집단·문명·그룹 유형">${[["organization","집단"],["civilization","문명"],["groups","그룹"]].map(([id,name])=>button(name,"view",id,ui.view===id?"active":"ghost")).join("")}</nav>` : ""}`;
}
function shell() {
  const nav = ui.tab === "main" ? mainNavigation() : writeNav.map(([v,i,n])=>`<button type="button" data-action="view" data-id="${v}" class="${ui.view===v?"active":""}"><span class="nav-icon">${i}</span>${n}</button>`).join("");
  return `<div class="shell"><aside class="sidebar"><a class="brand" href="#" data-action="home"><span class="brand-mark">M</span><h1>The Myth</h1><small>WORLD & WORDS</small></a><div class="side-caption">${ui.tab === "main" ? "WORLD ARCHIVE" : "WRITING ROOM"}</div><nav class="side-nav" aria-label="${ui.tab === "main" ? "본편 주메뉴" : "외전과 사상집 메뉴"}">${nav}</nav><div class="side-footer"><span class="side-caption">WORKSPACE</span><button data-action="view" data-id="trash">♲ 휴지통 <span>${db.entities.filter((x) => x.deleted_at).length + db.documents.filter((x) => x.deleted_at).length}</span></button><button data-action="backup">↗ 백업 및 복원</button><p>하나의 우주, 이어지는 이야기.<br><span>당신의 세계를 기록하는 곳</span></p></div></aside><main class="workspace"><header class="topbar"><nav class="top-tabs" aria-label="프로젝트 영역"><button data-action="tab" data-id="main" class="${ui.tab === "main" ? "active" : ""}">본편</button><button data-action="tab" data-id="writing" class="${ui.tab === "writing" ? "active" : ""}">외전+사상집</button></nav><div class="header-tools"><label class="global-search"><span>⌕</span><input id="global-search" aria-label="통합 검색" placeholder="세계관 전체에서 검색" value="${h(ui.query)}"><kbd>↵</kbd></label><span class="save-state">${h(saveStatus)}</span><button class="mobile-backup button ghost small" data-action="backup" aria-label="백업 및 복원">↗</button></div></header>${ui.tab === "main" ? commonSelection() : ""}<div id="page" class="content"></div><footer class="workspace-footer"><span>The Myth · 독립 창작 워크스테이션</span><span>우주 절대 연도 · 미확정 기록 지원</span></footer></main></div>`;
}
function header(eyebrow, title, subtitle, actions = "") {
  return `<div class="page-header"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p class="subtitle">${subtitle}</p></div><div class="actions">${actions}</div></div>`;
}
function empty(title, desc = "", action = "") {
  return `<div class="empty"><span class="empty-symbol">◇</span><h3>${title}</h3><p>${desc}</p>${action}</div>`;
}
function overview() {
  const generations = sorted(
    active("entities").filter((x) => x.kind === "generation"),
  );
  const titles = active("entities").filter((x) => x.kind === "title");
  const recent = active("entities")
    .filter((x) => !["generation", "title"].includes(x.kind))
    .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""))
    .slice(0, 5);
  return (
    header(
      "YOUR UNIVERSE, CONNECTED",
      "이야기는, 하나의 세계에서.",
      "흩어진 설정을 연결하고, 아직 쓰이지 않은 이야기를 이어가세요.",
      button("+ 새 자료 만들기", "new-entity", "", "primary"),
    ) +
    `<div class="banner"><div><span class="banner-kicker">The Myth / CREATOR’S WORKSPACE</span><h2>세계를 쌓고, 이야기를 쓰다.</h2><p>인물의 한 생애부터 우주의 긴 역사까지.<br>모든 작품이 하나의 아카이브에서 만납니다.</p><button class="text-link" data-action="view" data-id="archive">전체 아카이브 열기 <span>↗</span></button></div><div class="orbital" aria-hidden="true"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="orbit orbit-three"></div><span class="orbit-core">M</span><span class="orbit-dot"></span><span class="orbit-caption">ONE UNIVERSE<br>INFINITE STORIES</span></div></div><div class="stats-row">${[
      [
        "세계관 자료",
        active("entities").filter(
          (x) => !["generation", "title"].includes(x.kind),
        ).length,
        "공유되는 전역 객체",
      ],
      ["작품 타이틀", titles.length, "세대를 넘어 연결된 이야기"],
      ["기록된 관계", active("relations").length, "인물과 세계 사이의 연결"],
      ["집필 중인 원고", active("documents").length, "외전과 캐릭터의 사상집"],
    ]
      .map(
        ([n, v, s]) =>
          `<div class="stat"><span>${n}</span><strong>${String(v).padStart(2, "0")}</strong><small>${s}</small></div>`,
      )
      .join(
        "",
      )}</div><div class="overview-grid"><section class="panel"><div class="panel-header"><div><span class="eyebrow">THE MAIN STORY</span><h2>세대와 작품</h2></div>${button("관리 ↗", "view", "generations", "ghost small")}</div><div class="panel-body">${generations
      .map(
        (g, i) =>
          `<div class="generation-row"><div class="generation-number">0${i + 1}</div><div class="generation-content"><span class="muted">${g.data?.number != null ? h(g.data.number) + "세대" : "세대"}</span><button class="generation-title" data-action="open" data-id="${g.id}">${h(g.name)}</button><div class="title-links">${
            titles
              .filter((t) => t.data?.generation_id === g.id)
              .map(
                (t) =>
                  `<button class="title-link" data-action="title-filter" data-id="${t.id}">${h(t.name)} <span>↗</span></button>`,
              )
              .join("") ||
            '<span class="muted small-text">다음 이야기를 위한 열린 공간</span>'
          }</div></div></div>`,
      )
      .join(
        "",
      )}</div></section><section class="panel"><div class="panel-header"><div><span class="eyebrow">RECENT RECORDS</span><h2>최근의 기록</h2></div>${button("모두 보기 ↗", "view", "archive", "ghost small")}</div><div class="panel-body recent-records">${recent.length ? recent.map((e) => `<button class="recent-row" data-action="open" data-id="${e.id}"><span class="record-icon">${e.kind === "space" ? "◎" : "◇"}</span><span><strong>${h(e.name)}</strong><small>${names[e.kind] || e.kind} · ${h(e.description?.slice(0, 40) || "내용을 기록해 보세요")}</small></span><span>↗</span></button>`).join("") : empty("첫 기록을 남겨보세요", "아카이브에서 인물과 세계를 하나씩 연결하세요.")}</div><div class="panel-footnote"><span>✧</span> 확정되지 않은 설정은 비워둡니다.<br>모든 새로운 이야기는 당신의 선택에서 시작됩니다.</div></section></div><div class="quick-links">${[
      ["timeline", "↝", "통합 연대기", "연도가 없어도, 이야기는 흐릅니다."],
      ["spaces", "◎", "우주 공간", "은하에서 하나의 장소까지 탐색하세요."],
      ["book", "✎", "사상집 집필실", "인물의 목소리를 한 권의 책으로."],
    ]
      .map(
        ([v, i, n, s]) =>
          `<button data-action="quick" data-id="${v}"><span class="quick-icon">${i}</span><div><strong>${n}</strong><small>${s}</small></div><span>↗</span></button>`,
      )
      .join("")}</div>`
  );
}
function matches(e) {
  return (
    !ui.query ||
    `${e.name} ${e.description || ""} ${JSON.stringify(e.data || {})} ${e.body || ""}`
      .toLowerCase()
      .includes(ui.query.toLowerCase())
  );
}
function searchDocuments() {
  const docs = active("documents").filter(
    (document) =>
      matches(document) ||
      active("chapters").some(
        (chapter) => chapter.document_id === document.id && matches(chapter),
      ),
  );
  return docs.length
    ? `<section class="panel search-manuscripts"><div class="panel-header"><h2>검색된 외전·사상집 <span class="count">${docs.length}</span></h2></div><div class="panel-body">${docs.map((d) => `<div class="link-row"><button class="text-link" data-action="open" data-id="${d.id}">${h(d.name)} ↗</button><span class="muted">${d.kind === "book" ? "사상집" : "외전"} · ${h(d.status || "초안")}</span></div>`).join("")}</div></section>`
    : "";
}
function entityList() {
  let list = active("entities");
  if (ui.view === "character")
    list = list.filter((x) => x.kind === "character");
  else if (["organization","civilization"].includes(ui.view))
    list = list.filter((x) => x.kind === ui.view);
  else if (ui.view === "spaces")
    list = list.filter((x) => ["space", "planet"].includes(x.kind));
  else if (ui.view === "generations")
    list = list.filter((x) => ["generation", "title"].includes(x.kind));
  else if (["event", "setting", "thought", "thinker"].includes(ui.view))
    list = list.filter((x) => x.kind === ui.view);
  if (ui.kind) list = list.filter((x) => x.kind === ui.kind);
  if (ui.tab !== "main" && ui.title) {
    const ids = new Set(
      active("relations")
        .filter((r) => r.source_id === ui.title || r.target_id === ui.title)
        .flatMap((r) => [r.source_id, r.target_id]),
    );
    list = list.filter((x) => ids.has(x.id));
  }
  if (ui.group) {
    const ids = new Set(
      active("memberships")
        .filter((x) => x.group_id === ui.group)
        .map((x) => x.entity_id),
    );
    list = list.filter((x) => ids.has(x.id));
  }
  if (ui.tab === "main" && ui.view !== "generations") {
    list = scopedEntities(db,list,mainContext(),{includeCommon:["character","event"].includes(ui.view) ? !ui.mainTitle && ui.includeCommon : ui.includeCommon});
    if (ui.view === "spaces") list = withSpaceAncestors(active("entities").filter(e=>["space","planet"].includes(e.kind)),list);
  }
  return sorted(list.filter(matches));
}
const viewTitle = {
  archive: "전체 아카이브",
  character: "인물",
  organization: "집단",
  civilization: "문명",
  event: "사건",
  spaces: "우주 공간",
  setting: "세계관 설정",
  generations: "세대와 타이틀",
  thought: "사상 아카이브",
  thinker: "사상가",
};
function archive() {
  const list = entityList(), selected = db.entities.find(x=>x.id===ui.selected&&!x.deleted_at);
  const titleFilter = ui.tab === "main" ? "" : `<select id="title-filter" aria-label="타이틀 필터">${options(active("entities").filter(e=>e.kind==="title"),ui.title,"전체 타이틀")}</select>`;
  return header(ui.tab==="main"?"WORLD ARCHIVE":"PHILOSOPHY ARCHIVE",viewTitle[ui.view]||"아카이브",ui.view==="spaces"?"공통 우주의 원본 계층을 유지하며 관련 공간을 탐색합니다.":ui.view==="thought"?"인물과 사상가의 주장을 기록합니다. 주장은 세계관의 객관적 사실과 구분됩니다.":ui.view==="generations"?"기존 ID를 유지하며 세대와 작품을 추가·편집·정렬합니다.":"하나의 원본을 기록하고, 여러 작품에서 함께 참조하세요.",(ui.view==="spaces"?button("3D 지도","view","atlas","ghost"):"")+button(ui.view==="generations"?"+ 타이틀":"+ 새 자료","new-entity","","primary")+(ui.view==="generations"?button("+ 세대","new-generation","","ghost"):"")) + `${ui.query?searchDocuments():""}<div class="toolbar"><label class="search-field">⌕ <input id="list-search" aria-label="자료 검색" value="${h(ui.query)}" placeholder="이름, 설명, 설정에서 검색"></label><select id="kind-filter" aria-label="유형 필터">${option("","모든 유형",ui.kind)}${Object.entries(names).map(([k,n])=>option(k,n,ui.kind)).join("")}</select>${titleFilter}<select id="group-filter" aria-label="그룹 필터">${options(active("groups"),ui.group,"전체 그룹")}</select>${ui.query||ui.kind||ui.group||ui.tab!=="main"&&ui.title?button("필터 초기화","clear-filter","","ghost small"):""}</div><div class="split-view"><section class="list-panel"><div class="list-heading"><span>${ui.view==="spaces"?"공간 계층":"자료 목록"}</span><span class="count">${list.length}</span></div><div class="list-scroll">${ui.view==="spaces"&&!ui.query&&!ui.kind&&!ui.group?spaceTree(list):list.map(e=>listRow(e)).join("")||empty("자료가 없습니다","새 자료를 만들거나 선택한 세대와 타이틀을 바꿔보세요.")}</div></section><section class="detail-panel">${selected?entityDetail(selected):empty("기록을 선택하세요","왼쪽 목록에서 자료를 열거나 새로운 기록을 시작하세요.",button("+ 첫 자료 추가","new-entity","","primary"))}</section></div>`;
}
function listRow(e, depth = 0) {
  return `<button class="list-row ${ui.selected === e.id ? "selected" : ""}" data-action="select" data-id="${e.id}" style="padding-left:${20 + depth * 16}px"><span class="list-name">${h(e.name)}</span><span class="list-meta">${names[e.kind] || e.kind} ${e.data?.subtype ? "· " + h(e.data.subtype) : ""}${e.data?.status ? " · " + h(e.data.status) : ""}</span></button>`;
}
function spaceTree(list, parent = null, depth = 0, seen = new Set()) {
  return (
    list
      .filter(
        (e) =>
          (e.data?.parent_id || null) === parent ||
          (!parent &&
            e.data?.parent_id &&
            !list.some((x) => x.id === e.data.parent_id)),
      )
      .map((e) => {
        if (seen.has(e.id)) return "";
        seen.add(e.id);
        return listRow(e, depth) + spaceTree(list, e.id, depth + 1, seen);
      })
      .join("") ||
    (!parent
      ? empty("아직 공간이 없습니다", "은하, 행성, 도시를 자유롭게 연결하세요.")
      : "")
  );
}
function recordManagement(e) {
  return `<details class="record-tools"><summary>고급 관리</summary><div class="actions">${button("↑ 순서", "reorder-up", e.id, "small ghost")}${button("↓ 순서", "reorder-down", e.id, "small ghost")}${button("분할", "split", e.id, "small ghost")}${button("병합", "merge", e.id, "small ghost")}${button("삭제", "delete-entity", e.id, "small danger")}</div></details>`;
}
function entityDetail(e) {
  if (e.kind === "character" && ui.tab === "main") return characterDetail(e);
  return baseEntityDetail(e) + (e.kind === "event" ? eventConnections(e) : "");
}
function profileOptions(fieldInfo, selected, multiple = false) {
  const selectedIds = Array.isArray(selected) ? selected : selected ? [selected] : [];
  const kinds = fieldInfo.kinds || (fieldInfo.key === "organization_ids" ? ["organization","civilization"] : fieldInfo.key === "activity_planet_id" ? ["planet"] : ["space","planet"]);
  return (multiple ? "" : option("", "미정", selected)) + sorted(db.entities.filter(e=>kinds.includes(e.kind) && (!e.deleted_at || selectedIds.includes(e.id)))).map(e=>`<option value="${h(e.id)}" ${selectedIds.includes(e.id)?"selected":""}>${h(e.name)}${e.deleted_at?" (보관된 자료)":""}</option>`).join("");
}
function profileControl(info, value, name, disabled = false) {
  const flag = disabled ? "disabled" : "";
  if (info.type === "time") return `<fieldset class="profile-time" ${flag}>${timeFields(name, value)}</fieldset>`;
  if (info.type === "id" || info.type === "id-list") return `<select name="${name}" ${info.type === "id-list" ? 'multiple size="4"' : ""} ${flag}>${profileOptions(info,value,info.type === "id-list")}</select>`;
  if (info.type === "textarea") return `<textarea name="${name}" rows="3" ${flag}>${h(value ?? "")}</textarea>`;
  return input(name, Array.isArray(value) ? value.join(", ") : value ?? "", "", flag);
}
function commonCharacterFields(e) {
  const values = commonProfile(e);
  return PROFILE_FIELDS.filter(f=>!["name","aliases","description"].includes(f.key)).map(info=>field(info.label, profileControl(info, values[info.key], info.type === "time" ? "time" : "data_" + info.key), info.type === "textarea" || info.type === "time")).join("");
}
function titleDraftKey(characterId, titleId) { return "title-settings:" + characterId + ":" + titleId; }
function archivedAppearanceView(character,relation) {
  const titleId=relation.source_id===character.id?relation.target_id:relation.source_id,profile=resolveTitleProfile(character,relation);
  const fields=PROFILE_FIELDS.filter(f=>profile.sources[f.key]!=='common');
  return `<details><summary>${h(label(titleId))} · ${hasAppearanceContent(relation)?'작품별 내용 보관됨':'연결 이력 보관됨'}</summary>${fields.length?`<dl>${fields.map(f=>`<dt>${h(f.label)}</dt><dd>${h(profileDisplay(profile.values[f.key]))}</dd>`).join('')}</dl>`:'<p class="muted">모든 항목이 공통 설정을 사용합니다.</p>'}${relation.start||relation.end?`<p>기존 등장 시점: ${h(timeLabel(relation.start))}${relation.end?' ~ '+h(timeLabel(relation.end)):''}</p>`:''}</details>`;
}
function characterDetail(e) {
  const all = appearancesFor(db,e.id), activeTitles = [...new Set(all.map(r=>r.source_id === e.id ? r.target_id : r.source_id))].map(lookup).filter(t=>t?.kind === "title" && !t.deleted_at);
  ui.characterSlots ||= {};
  let selected = ui.characterSlots[e.id] || "common";
  if (selected !== "common" && !activeTitles.some(t=>t.id===selected)) selected = "common";
  ui.characterSlots[e.id] = selected;
  const checkDraft = localDrafts["appearance-checks:" + e.id];
  const checked = checkDraft?.title_ids || activeTitles.map(t=>t.id);
  const archived = appearancesFor(db,e.id,{includeArchived:true}).filter(r=>r.deleted_at);
  const duplicate = activeTitles.filter(t=>all.filter(r=>r.source_id===t.id||r.target_id===t.id).length>1);
  const fields = catalogGenerations(db).map(g=>`<fieldset><legend>${h(g.data?.number||"")}세대 · ${h(g.name)}</legend>${titlesForGeneration(db,g.id).map(t=>`<label class="appearance-choice"><input type="checkbox" name="title_ids" value="${t.id}" ${checked.includes(t.id)?"checked":""}><span>${h(t.name)}</span></label>`).join("") || '<p class="muted">확정된 타이틀이 생기면 선택할 수 있습니다.</p>'}</fieldset>`).join("");
  const draft = localDrafts["entity:"+e.id];
  const x = draft ? {...e,...draft,data:{...e.data,...draft.data}} : e;
  const relation = selected === "common" ? null : appearanceFor(db,e.id,selected);
  const editor = selected === "common"
    ? `<form id="entity-form" data-id="${e.id}"><div class="profile-heading"><h3>공통 설정</h3><p>모든 작품에서 함께 사용하는 인물의 기본 정체성입니다. 출신 행성과 기존 연결은 유지됩니다.</p></div><div class="form-grid">${entityFields(x)}</div><div class="form-actions"><span class="draft-notice muted">${draft?"브라우저에 보관된 미저장 변경사항이 있습니다.":"공통값을 상속하는 작품에도 반영됩니다."}</span><button class="button primary" type="submit">변경사항 저장</button></div>${draftRecovery("entity:"+e.id)}</form>`
    : relation ? titleSettingsForm(e,lookup(selected),relation) : '<p class="conflict">등장 연결이 중복되어 작품별 값을 결정할 수 없습니다. 아래 연결된 자료에서 기존 연결을 먼저 확인하세요.</p>';
  return `<div class="detail-header"><div><span class="eyebrow">인물 / GLOBAL RECORD</span><h2>${h(e.name)}</h2><small class="muted">${h(e.id)}</small></div>${recordManagement(e)}</div><section class="appearance-section"><div class="section-title"><h3>등장 작품</h3><span class="muted">여러 작품에서 같은 인물을 연결합니다.</span></div><form id="appearance-form" data-id="${e.id}"><div class="appearance-grid">${fields}</div>${duplicate.length?`<p class="conflict">중복 등장 연결 확인 필요: ${duplicate.map(t=>h(t.name)).join(", ")}</p>`:""}<div class="form-actions"><small class="muted">체크를 해제해도 인물과 작품별 기록은 보관됩니다.</small><div class="actions">${button("저장된 연결 다시 불러오기","discard-appearance-draft",e.id,"ghost small")}${button("최신 연결과 비교해 다시 저장","rebase-appearance-draft",e.id,"ghost small")}<button type="submit" class="button small primary">등장 작품 저장</button></div></div></form>${archived.length?`<details class="archived-slots"><summary>연결 해제된 작품 기록 ${archived.length}개</summary><p class="muted">작품을 다시 체크하면 기존 연결과 설정을 복구합니다.</p>${archived.map(r=>archivedAppearanceView(e,r)).join("")}</details>`:""}</section><nav class="character-slot-tabs" aria-label="인물 정보 슬롯">${button("공통 설정","character-slot",e.id+"|common",selected==="common"?"active":"ghost")}${sorted(activeTitles).map(t=>button(h(t.name),"character-slot",e.id+"|"+t.id,selected===t.id?"active":"ghost")).join("")}</nav>${editor}<div class="detail-sections">${referenceSection(e.id)}${entityTimeline(e)}${membershipSection(e)}${historySection("entities",e.id)}</div>`;
}
function profileDisplay(value) {
  if (value == null || value === "" || Array.isArray(value) && !value.length) return "미정";
  if (Array.isArray(value)) return value.map(v=>lookup(v)?label(v):v).join(", ");
  if (typeof value === "object") return timeLabel(value);
  return lookup(value) ? label(value) : String(value);
}
function titleSettingsForm(character,title,relation) {
  const resolved = resolveTitleProfile(character,relation), common = commonProfile(character), key=titleDraftKey(character.id,title.id), draft=localDrafts[key];
  resolved.warnings = profileTimelineWarnings(db,character,relation);
  return `<form id="title-settings-form" data-character="${character.id}" data-title="${title.id}" data-relation="${relation.id}"><div class="profile-heading"><h3>${h(title.name)} · 작품별 설정</h3><p>공통 설정을 기본으로 사용하고, 이 작품에서 달라지는 항목만 개별 설정으로 기록합니다.</p></div>${resolved.warnings?.length?`<div class="conflict">${resolved.warnings.map(h).join("<br>")}</div>`:""}<div class="title-profile-grid">${PROFILE_FIELDS.map(info=>{
    const mode = draft?.raw?.["mode_"+info.key] || (resolved.sources[info.key] === "common" ? "common" : "custom");
    const value = resolved.values[info.key];
    return `<section class="title-profile-field" data-profile-key="${info.key}"><div class="profile-field-heading"><label for="profile-mode-${info.key}">${h(info.label)}</label><span class="profile-source">${mode==="common"?"공통 설정 상속":resolved.sources[info.key]==="legacy"?"기존 작품 기록":"타이틀별 개별 설정"}</span></div><select id="profile-mode-${info.key}" name="mode_${info.key}" data-profile-mode="${info.key}" aria-label="${h(info.label)} 설정 방식">${option("common","공통 설정 사용",mode)}${option("custom","타이틀별 개별 설정",mode)}</select><div class="profile-value">${profileControl(info,value,"profile_"+info.key,mode==="common")}</div><p class="profile-common-preview">공통값: ${h(profileDisplay(common[info.key]))}</p></section>`;
  }).join("")}</div><div class="form-actions"><span class="muted">${draft?"이 작품 슬롯의 미저장 초안을 복구했습니다.":"다른 작품이나 공통 설정은 변경하지 않습니다."}</span><button type="submit" class="button primary">작품별 설정 저장</button></div><div class="slot-draft-actions actions">${button("이 슬롯의 서버 내용 사용","discard-title-draft",key,"small ghost")}${button("최신 설정과 비교해 내 초안 저장","rebase-title-draft",key,"small ghost")}</div></form>`;
}
function eventConnectionRow(relation,event) {
  const source=relation.source_id===event.id,otherId=source?relation.target_id:relation.source_id;
  const description = relation.type==='before' ? source?'이 사건이 먼저 발생':'연결된 사건이 먼저 발생' : relation.type==='after' ? source?'연결된 사건 이후에 이 사건 발생':'이 사건 이후에 연결된 사건 발생' : relation.type==='causes' ? source?'이 사건이 원인 → 연결된 사건이 결과':'연결된 사건이 원인 → 이 사건이 결과' : relation.type==='caused_by' ? source?'연결된 사건이 원인 → 이 사건이 결과':'이 사건이 원인 → 연결된 사건이 결과' : '관련 사건';
  const other=lookup(otherId),titleId=other?.data?.title_id||(other?titleIdsForEntity(db,other)[0]:null);
  return `<div class="relation-row"><div><span class="muted">${h(description)}</span><button class="text-link" data-action="open" data-id="${otherId}">${h(label(otherId))} ↗</button><small>${h(label(titleId))} · ${h(relation.data?.note||'')}</small></div><div class="actions">${button('수정','edit-relation',relation.id,'ghost small')}${button('연결 해제','delete-relation',relation.id,'ghost small')}</div></div>`;
}
function eventConnections(e) {
  const relations=active("relations").filter(r=>(r.source_id===e.id||r.target_id===e.id)&&lookup(r.source_id)?.kind==="event"&&lookup(r.target_id)?.kind==="event");
  return `<section class="event-connections"><div class="section-title"><h3>연관 사건</h3>${button("+ 사건 연결","new-event-relation",e.id,"small ghost")}</div><p class="muted">같은 세대의 다른 타이틀 사건도 연결할 수 있습니다. 화살표는 저장된 방향을 나타냅니다.</p>${relations.map(r=>`${eventConnectionRow(r,e)}${eventRelationWarnings(db,r).map(w=>`<p class="conflict">${h(w)}</p>`).join("")}`).join("") || '<p class="muted">연결된 사건이 없습니다.</p>'}</section>`;
}
function eventRelationEditor(eventId) {
  const source=lookup(eventId), linked=titleIdsForEntity(db,source), sourceTitle=source.data?.title_id || (linked.length===1?linked[0]:null), gen=generationForTitle(db,sourceTitle);
  const targets=active("entities").filter(e=>e.kind==="event"&&e.id!==eventId).filter(e=>!gen||generationForTitle(db,e.data?.title_id||titleIdsForEntity(db,e)[0])?.id===gen.id);
  openDialog("연관 사건 연결",`<p class="callout">${h(source.name)}에서 대상 사건으로 향하는 관계를 기록합니다. 미확정 시점을 임의의 연도로 바꾸지 않습니다.</p><div class="form-grid">${field("대상 사건",`<select name="target_id" required>${option("","사건 선택","")}${targets.map(e=>option(e.id,`${e.name} · ${label(e.data?.title_id||titleIdsForEntity(db,e)[0])}`,"")).join("")}</select>`)}${field("이 사건과 대상 사건의 관계",`<select name="type">${[["related","관련 사건"],["before","이 사건이 대상 사건보다 먼저"],["after","이 사건이 대상 사건보다 나중"],["causes","이 사건이 원인 → 대상 사건이 결과"],["caused_by","이 사건이 결과 ← 대상 사건이 원인"]].map(([v,n])=>option(v,n,"related")).join("")}</select>`)}${field("관계 설명",textarea("note",""),true)}</div>`,async fd=>{
    const body={source_id:eventId,target_id:fd.get("target_id"),type:fd.get("type"),data:{note:fd.get("note")},start:{mode:"unknown"},end:null};
    const warnings=eventRelationWarnings(db,body);
    if(warnings.length&&!confirm(warnings.join("\n")+"\n시간 기록은 덮어쓰지 않고 관계를 저장하시겠습니까?"))return;
    await mutate("/relations","POST",body,"사건을 연결했습니다.");
  },"사건 연결");
}

function baseEntityDetail(e) {
  const draft = localDrafts["entity:" + e.id];
  const x = draft ? { ...e, ...draft, data: { ...e.data, ...draft.data } } : e;
  return `<div class="detail-header"><div><span class="eyebrow">${names[e.kind] || h(e.kind)} / GLOBAL RECORD</span><h2>${h(e.name)}</h2><small class="muted">${h(e.id)}</small></div>${ui.tab === "main" ? recordManagement(e) : `<div class="actions">${button("↑", "reorder-up", e.id, "small ghost")}${button("↓", "reorder-down", e.id, "small ghost")}${button("분할", "split", e.id, "small ghost")}${button("병합", "merge", e.id, "small ghost")}${button("삭제", "delete-entity", e.id, "small danger")}</div>`}</div><form id="entity-form" data-id="${e.id}"><div class="form-grid">${entityFields(x)}</div><div class="form-actions"><span class="draft-notice muted">${draft ? "브라우저에 보관된 미저장 변경사항이 있습니다." : "고유 ID로 연결되어 이름을 바꾸어도 참조가 유지됩니다."}</span><button class="button primary" type="submit">변경사항 저장</button></div>${draftRecovery("entity:" + e.id)}</form><div class="detail-sections">${referenceSection(e.id)}${entityTimeline(e)}${membershipSection(e)}${historySection("entities", e.id)}</div>`;
}
function entityFields(e) {
  const d = e.data || {};
  let html =
    field("이름", input("name", e.name, "자료 이름", "required")) +
    field(
      "분류",
      `<select name="kind" ${e.id ? "disabled" : ""}>${Object.entries(names)
        .map(([k, n]) => option(k, n, e.kind))
        .join("")}</select>`,
    ) +
    field(
      "설명 · 기본 프로필",
      textarea(
        "description",
        e.description,
        "정의와 배경, 확정된 사실을 기록하세요.",
      ),
      true,
    ) +
    field("상태", input("data_status", d.status, "예: 구상 / 집필 중 / 확정")) +
    field(
      "세부 분류",
      input("data_subtype", d.subtype, "예: 은하 / 무술 / 고유 분류"),
    );
  if (e.kind === "generation")
    html += field(
      "세대 번호 (목록 순서와 별개)",
      input("data_number", d.number ?? "", "", 'type="number" min="1"'),
    );
  if (e.kind === "title")
    html += field(
      "소속 세대",
      `<select name="data_generation_id">${options(
        active("entities").filter(
          (x) => x.kind === "generation" && x.id !== e.id,
        ),
        d.generation_id,
        "미정",
      )}</select>`,
    );
  if (["title","generation"].includes(e.kind)) html += field("표시 순서",input("sort_order",e.sort_order ?? (e.kind === "title" ? titlesForGeneration(db,d.generation_id || ui.mainGeneration).length : 0),"",'type="number"'));
  if (e.kind === "character")
    html +=
      field(
        "별칭",
        input(
          "data_aliases",
          Array.isArray(d.aliases) ? d.aliases.join(", ") : d.aliases,
          "쉼표로 구분",
        ),
      ) +
      field(
        "출신 행성 · 기본 정체성",
        `<select name="data_origin_planet_id">${options(
          active("entities").filter((x) => x.kind === "planet"),
          d.origin_planet_id,
          "출신 행성 미정",
        )}</select>`,
      ) +
      field(
        "출신 문명",
        `<select name="data_civilization_id">${options(
          active("entities").filter((x) => x.kind === "civilization"),
          d.civilization_id,
          "문명 미정",
        )}</select>`,
      ) +
      field("종족", input("data_species", d.species, "미정"));
  if (e.kind === "character") html += commonCharacterFields(e);
  if (e.kind === "event") {
    const linkedTitles = e.id ? titleIdsForEntity(db,e) : [];
    const eventTitle = d.title_id || (e.id ? linkedTitles.length === 1 ? linkedTitles[0] : "" : ui.mainTitle) || "";
    const generation = generationForTitle(db,eventTitle) || lookup(d.generation_id);
    html += field("소속 타이틀", `<select name="data_title_id" ${e.id ? "" : "required"}>${options(active("entities").filter(x=>x.kind==="title"),eventTitle,"타이틀 선택")}</select>`) + field("소속 세대", input("event_generation_display",generation?.name||"타이틀을 선택하면 정해집니다.","","readonly")) + field("사건 결과",textarea("data_result",d.result),true) + '<p class="wide muted">관련 인물·집단·발생 장소는 아래 연결된 자료에서 원본 객체와 연결하세요.</p>';
  }
  if (["space", "planet"].includes(e.kind))
    html +=
      field(
        "상위 물리적 공간",
        `<select name="data_parent_id">${options(
          active("entities").filter(
            (x) => ["space", "planet"].includes(x.kind) && x.id !== e.id,
          ),
          d.parent_id,
          "최상위 공간",
        )}</select>`,
      ) +
      field(
        "환경과 지리",
        textarea(
          "data_environment",
          d.environment,
          "물리적 환경을 기록하세요.",
        ),
        true,
      ) +
      field(
        "문화·문명 및 종족",
        textarea(
          "data_culture",
          d.culture,
          "통치 관계는 아래 시점별 관계에서 따로 관리합니다.",
        ),
        true,
      ) +
      field(
        "갤럭시 마스터 존재",
        `<select name="data_galaxy_master_status">${[
          ["", "미정"],
          ["present", "존재"],
          ["absent", "없음 (예외)"],
        ]
          .map(([v, l]) => option(v, l, d.galaxy_master_status))
          .join("")}</select>`,
      ) +
      field(
        "통치 제도·권한 (미확정 가능)",
        textarea("data_governance", d.governance, "확정된 경우에만 입력"),
      );
  if (e.kind === "setting")
    html +=
      field("관련 원리", textarea("data_principles", d.principles), true) +
      field("사용 조건", textarea("data_conditions", d.conditions), true);
  if (e.kind === "thought")
    html +=
      field("중심 주장", textarea("data_claims", d.claims), true) +
      field("논거", textarea("data_arguments", d.arguments), true) +
      field("반론", textarea("data_objections", d.objections), true) +
      `<p class="wide callout">사상가의 주장은 세계관의 객관적 진실을 확정하지 않습니다.</p>`;
  if (e.kind === "custom")
    html += field(
      "사용자 정의 분류명",
      input("data_category", d.category, "분류 이름을 자유롭게 입력"),
    );
  if (e.kind === "thinker")
    html += field(
      "사상가 구분",
      `<select name="data_thinker_type">${[
        ["fictional", "가상 사상가"],
        ["historical", "실제 역사 속 사상가"],
      ]
        .map(([v, l]) => option(v, l, d.thinker_type || "fictional"))
        .join("")}</select>`,
    );
  if (["event", "title", "generation"].includes(e.kind))
    html += `<details class="wide" ${d.time ? "open" : ""}><summary>서사 시간 · 연도 미확정 가능</summary>${timeFields("time", d.time)}</details>`;
  const known = [
    "status",
    "subtype",
    "generation_id",
    "aliases",
    "origin_planet_id",
    "civilization_id",
    "species",
    "parent_id",
    "environment",
    "culture",
    "galaxy_master_status",
    "governance",
    "principles",
    "conditions",
    "claims",
    "arguments",
    "objections",
    "thinker_type",
    "category",
    "number",
    "time",
    "title_id",
    "result",
    "catalog_key",
    "appearance_revision",
    ...(e.kind === "character" ? PROFILE_FIELDS.map(f=>f.key) : []),
  ];
  const custom = Object.fromEntries(
    Object.entries(d).filter(([k]) => !known.includes(k)),
  );
  html += `<details class="wide"><summary>사용자 정의 정보 (JSON)</summary>${field("추가 필드", textarea("custom_data", JSON.stringify(custom, null, 2), "{}", 5), true)}<small class="muted">기타 설정을 자유롭게 확장할 수 있습니다. 기존 기본 필드는 위의 입력란에서 수정하세요.</small></details>`;
  return html;
}
function readEntity(form, e = {}) {
  const fd = new FormData(form);
  let data = { ...(e.data || {}) };
  for (const [k, v] of fd.entries())
    if (k.startsWith("data_")) data[k.slice(5)] = v || null;
  if (fd.has("data_number"))
    data.number =
      fd.get("data_number") === "" ? null : Number(fd.get("data_number"));
  if (fd.has("data_aliases"))
    data.aliases = (fd.get("data_aliases") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  if (fd.has("time_mode")) data.time = readTime(fd, "time");
  if (form.elements.namedItem("data_organization_ids")) data.organization_ids = fd.getAll("data_organization_ids");
  if (fd.has("data_title_id") && data.title_id) data.generation_id = generationForTitle(db,data.title_id)?.id || null;
  else if (fd.has("data_title_id") && e.data?.title_id) data.generation_id = null;
  let custom = JSON.parse(fd.get("custom_data") || "{}");
  if (!custom || Array.isArray(custom) || typeof custom !== "object")
    throw new Error("사용자 정의 정보는 JSON 객체여야 합니다.");
  data = { ...data, ...custom };
  return {
    name: fd.get("name").trim(),
    kind: fd.get("kind") || e.kind,
    description: fd.get("description") || "",
    data,
    ...(fd.has("sort_order") ? {sort_order:Number(fd.get("sort_order") || 0)} : {}),
  };
}
function referenceSection(id) {
  const rels = active("relations").filter(
    (r) => r.source_id === id || r.target_id === id,
  );
  const children = active("entities").filter(
    (e) =>
      e.data?.parent_id === id ||
      e.data?.origin_planet_id === id ||
      e.data?.generation_id === id ||
      e.data?.civilization_id === id,
  );
  return `<section><div class="section-title"><h3>연결된 자료 <span class="count">${rels.length}</span></h3>${button("+ 관계 연결", "new-relation", id, "small ghost")}</div>${rels.map((r) => relationRow(r, id)).join("") || '<p class="muted">연결된 관계가 없습니다. 타이틀, 인물, 문명, 사상을 고유 ID로 연결하세요.</p>'}${children.length ? `<div class="section-title"><h4>이 자료를 참조하는 기록</h4></div><div class="reference-chips">${children.map((e) => `<button class="title-link" data-action="open" data-id="${e.id}">${h(e.name)} ↗</button>`).join("")}</div>` : ""}</section>`;
}
function relationRow(r, id) {
  const other = r.source_id === id ? r.target_id : r.source_id;
  const character = lookup(r.source_id)?.kind === 'character' ? lookup(r.source_id) : lookup(r.target_id)?.kind === 'character' ? lookup(r.target_id) : null;
  const titleId = character && (r.source_id === character.id ? r.target_id : r.source_id);
  const slot = r.type === 'appearance' && character && lookup(titleId)?.kind === 'title';
  return `<div class="relation-row"><div><span class="muted">${r.source_id === id ? "→" : "←"} ${h(relNames[r.type] || r.type)}</span> <button class="text-link" data-action="open" data-id="${other}">${h(label(other))}${lookup(other)?.deleted_at ? " (휴지통)" : ""}</button><small>${h(r.data?.role || r.data?.note || "")} · ${h(timeLabel(r.start))}${r.end ? " ~ " + h(timeLabel(r.end)) : ""}</small></div><div class="actions">${slot?button("작품별 설정","open-title-slot",character.id+'|'+titleId,"ghost small"):""}${button(slot?"관계·시점":"수정", "edit-relation", r.id, "ghost small")}${button("연결 해제", "delete-relation", r.id, "ghost small")}</div></div>`;
}
function entityTimeline(e) {
  const states = active("states")
    .filter((s) => s.entity_id === e.id)
    .sort(
      (a, b) =>
        (a.start?.year ?? a.start?.start ?? Infinity) -
        (b.start?.year ?? b.start?.start ?? Infinity),
    );
  return `<section><div class="section-title"><h3>시대별 변화</h3>${button("+ 상태 기록", "new-state", e.id, "ghost small")}</div><p class="muted small-text">출신 행성과 기본 정체성은 유지됩니다. 활동지, 나이, 가치관의 변화는 과거를 덮어쓰지 않고 기록합니다.</p>${states.map((s) => `<div class="timeline-row"><span class="time-tag">${h(timeLabel(s.start))}<small>${s.end ? "~ " + h(timeLabel(s.end)) : ""}</small></span><div><strong>${h(s.attribute)}</strong><p>${h(s.value)}</p></div><div class="actions">${button("수정", "edit-state", s.id, "ghost small")}${button("삭제", "delete-state", s.id, "ghost small")}</div></div>`).join("") || '<p class="muted">아직 기록된 변화가 없습니다.</p>'}</section>`;
}
function membershipSection(e) {
  const memberships = active("memberships").filter((m) => m.entity_id === e.id);
  return `<section><div class="section-title"><h3>자료 그룹</h3>${button("+ 그룹에 추가", "add-membership", e.id, "ghost small")}</div><div class="reference-chips">${memberships.map((m) => `<span class="pill">${h(label(m.group_id))} <button type="button" data-action="remove-membership" data-id="${m.id}" title="그룹에서만 제거">×</button></span>`).join("") || '<span class="muted">그룹에 소속되지 않았습니다.</span>'}</div><p class="muted small-text">그룹에서 제거해도 전역 자료는 삭제되지 않습니다.</p></section>`;
}
function historySection(type, id) {
  const versions = (db.versions || [])
    .filter((v) => v.target_type === type && v.target_id === id)
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  return `<details class="history"><summary>수정 이력 및 이전 버전 복원 <span class="count">${versions.length}</span></summary>${
    versions
      .slice(0, 40)
      .map(
        (v) =>
          `<div class="version-row"><div><strong>${h(v.label || "이전 버전")}</strong><small>${date(v.created_at)}</small></div>${button("복원", "restore-version", v.id, "ghost small")}</div>`,
      )
      .join("") || '<p class="muted">첫 수정 후 이전 버전이 보관됩니다.</p>'
  }</details>`;
}
function groupsView() {
  const list = sorted(ui.tab === "main" ? scopedGroups(db,active("groups"),mainContext()) : active("groups"));
  return (
    header(
      "COLLECTIONS",
      "그룹 관리",
      "자료를 복제하지 않고 여러 그룹에 함께 모으세요. 그룹의 계층과 소속은 자유롭게 바꿀 수 있습니다.",
      button("+ 새 그룹", "new-group", "", "primary"),
    ) +
    `<div class="overview-grid">${
      list
        .map((g) => {
          const allMembers = sorted(active("memberships").filter(m=>m.group_id===g.id));
          const members = ui.tab === "main" ? allMembers.filter(m=>scopedEntities(db,[lookup(m.entity_id)].filter(Boolean),mainContext()).length) : allMembers;
          return `<section class="panel"><div class="panel-header"><div><span class="eyebrow">${g.parent_id ? h(label(g.parent_id)) + " / " : ""}COLLECTION</span><h2>${h(g.name)}</h2><p class="muted">${h(g.description || "설명 없음")}</p></div><div class="actions">${button("수정", "edit-group", g.id, "ghost small")}${button("삭제", "delete-group", g.id, "danger small")}</div></div><div class="panel-body"><p class="muted small-text">선택 범위의 자료 ${members.length}개 / 전체 ${allMembers.length}개</p>${members.map((m) => `<div class="link-row"><button class="text-link" data-action="open" data-id="${m.entity_id}">${h(label(m.entity_id))} ↗</button><div class="actions">${button("↑", "group-member-up", m.id, "ghost small")}${button("↓", "group-member-down", m.id, "ghost small")}${button("그룹에서 제거", "remove-membership", m.id, "ghost small")}</div></div>`).join("") || '<p class="muted">아직 연결한 자료가 없습니다.</p>'}${button("+ 자료 연결", "group-add-entity", g.id, "ghost small")}</div></section>`;
        })
        .join("") ||
      empty(
        "아직 그룹이 없습니다",
        "등장인물 묶음, 연구 노트, 서사 단위를 자유롭게 구성하세요.",
      )
    }</div>`
  );
}
function timelineView() {
  const titleSelector = ui.tab === "main" ? "" : `<select id="timeline-title" aria-label="연대기 타이틀">${options(active("entities").filter(e=>e.kind==="title"),ui.title,"모든 작품")}</select>`;
  return header("THE UNIVERSAL CHRONICLE","통합 연대기","연도 미확정 사건도 하나의 시간축에. 목록 순서와 세계관 속 연대는 별개입니다.",button("+ 사건 기록","new-event","","primary")) + `<div class="toolbar">${field("우주 절대 연도",input("timeline_year",ui.year??"","미확정은 빈칸",'type="number" id="timeline-year"'))}${titleSelector}${button("시점 조회","load-timeline","","primary")}${button("전체 시간 보기","reset-time","","ghost")}</div><div id="timeline-result"><p class="muted">연대기를 불러오는 중…</p></div>`;
}
async function loadTimeline() {
  const q = new URLSearchParams(ui.tab === "main" ? timelineParameters(mainContext(),ui.year) : {});
  if (ui.tab !== "main") {
    if (ui.year !== "" && ui.year != null) q.set("year",ui.year);
    if (ui.title) q.set("title_id",ui.title);
  }
  const result = await api("/timeline?" + q);
  const el = $("#timeline-result");
  if (!el) return;
  const rawEvents =
    result.events ||
    result.entries ||
    active("entities").filter((e) => e.kind === "event");
  const events = rawEvents.map((x) => x.entity || x).filter((x) => x.name);
  const titles = (
    result.titles || active("entities").filter((e) => e.kind === "title")
  ).map((x) => x.entity || x);
  const states = result.effective_states || result.states || [],
    relations = result.effective_relations || result.relations || [];
  el.innerHTML = `${(result.conflicts || []).length ? `<div class="conflict"><strong>충돌을 확인하세요</strong>${result.conflicts.map((c) => `<p>${h(typeof c === "string" ? c : c.message || JSON.stringify(c))}</p>`).join("")}</div>` : ""}<div class="overview-grid"><section class="panel"><div class="panel-header"><h2>사건의 흐름</h2>${tag(events.length + "개 기록")}</div><div class="panel-body">${events.map((e) => `<div class="timeline-row"><span class="time-tag">${h(timeLabel(e.data?.time || e.time))}</span><div><button class="text-link" data-action="open" data-id="${e.id}">${h(e.name)} ↗</button><p>${h(e.description || "")}</p></div><div class="actions">${button("↑", "reorder-up", e.id, "ghost small")}${button("↓", "reorder-down", e.id, "ghost small")}</div></div>`).join("") || empty("아직 기록된 사건이 없습니다", "미확정 연도로도 첫 사건을 기록할 수 있습니다.")}</div></section><section class="panel"><div class="panel-header"><h2>중첩되는 작품의 시간</h2></div><div class="panel-body">${titles
    .filter((t) => !(ui.tab === "main" ? ui.mainTitle : ui.title) || t.id === (ui.tab === "main" ? ui.mainTitle : ui.title))
    .map(
      (t) =>
        `<div class="timeline-row"><span class="time-tag">${h(timeLabel(t.data?.time))}</span><button class="text-link" data-action="open" data-id="${t.id}">${h(t.name)} ↗</button></div>`,
    )
    .join(
      "",
    )}<p class="muted small-text">서로 겹치는 기간을 허용합니다. 비어 있는 연도는 가짜 숫자로 대체되지 않습니다.</p></div></section></div><section class="panel" style="margin-top:24px"><div class="panel-header"><h2>${ui.year !== "" && ui.year != null ? h(ui.year) + "년의" : "선택 범위의"} 유효 상태와 관계</h2>${tag("불확실성 보존")}</div><div class="panel-body">${states.map((s) => `<div class="link-row"><button class="text-link" data-action="open" data-id="${s.entity_id}">${h(label(s.entity_id))}</button><span>${h(s.attribute)} · ${h(s.value)}</span><span class="muted">${h(timeLabel(s.start))}</span></div>`).join("")}${relations.map((r) => relationRow(r, r.source_id)).join("")}${!states.length && !relations.length ? '<p class="muted">이 범위에서 확정할 수 있는 상태·관계가 없습니다.</p>' : ""}${
    (result.uncertain || []).length
      ? `<details><summary>시점을 확정할 수 없는 기록 ${(result.uncertain || []).length}개</summary>${result.uncertain
          .map((x) => {
            const r = x.record || x;
            return `<div class="link-row">${h(r.name || label(r.entity_id || r.source_id) || x.message || "미확정 기록")} <span>${h(r.attribute || relNames[r.type] || "")} · ${h(timeLabel(r.start || r.data?.time))}</span></div>`;
          })
          .join("")}</details>`
      : ""
  }</div></section>`;
}
function writing() {
  const docs = sorted(
      active("documents").filter((d) => d.kind === ui.view && matches(d)),
    ),
    d = docs.find((x) => x.id === ui.selected);
  return (
    header(
      ui.view === "book" ? "CHARACTER’S BOOKS" : "SIDE STORIES",
      ui.view === "book" ? "사상집 집필실" : "외전 창작실",
      ui.view === "book"
        ? "인물의 목소리로 쓰는 한 권의 책. 주장과 세계의 사실을 구분하며 집필합니다."
        : "본편과 연결된 또 하나의 이야기. 초안은 공통 세계관을 자동 변경하지 않습니다.",
      button(
        ui.view === "book" ? "+ 새 서적" : "+ 새 외전",
        "new-document",
        "",
        "primary",
      ),
    ) +
    `<div class="split-view writing-view"><section class="list-panel"><div class="list-heading"><span>${ui.view === "book" ? "서적 목록" : "외전 목록"}</span><span class="count">${docs.length}</span></div>${docs.map((x) => `<button class="list-row ${ui.selected === x.id ? "selected" : ""}" data-action="select-doc" data-id="${x.id}"><span class="list-name">${h(x.name)}</span><span class="list-meta">${h(x.status || "초안")} · ${h(x.author_id ? label(x.author_id) : "저자 미정")}</span></button>`).join("") || empty("새 원고를 시작하세요", "아직 등록된 작품이 없습니다.")}</section><section class="detail-panel">${d ? documentDetail(d) : empty("아직 쓰이지 않은 이야기", "작품을 선택하거나 새 원고를 만들어 집필을 시작하세요.", button("+ 원고 시작", "new-document", "", "primary"))}</section></div>`
  );
}
function documentDetail(d) {
  const chapters = sorted(
      active("chapters").filter((c) => c.document_id === d.id),
    ),
    c = chapters.find((x) => x.id === ui.chapter);
  const draft = localDrafts[(c ? "chapter:" : "document:") + (c?.id || d.id)];
  const body = draft?.body ?? c?.body ?? d.body ?? "";
  return `<div class="detail-header"><div><span class="eyebrow">${d.kind === "book" ? "PHILOSOPHY MANUSCRIPT" : "SIDE STORY MANUSCRIPT"}</span><h2>${h(d.name)}</h2><div class="reference-chips">${tag(d.status || "초안")}${tag({ draft: "설정 초안", confirmed: "확정", noncanon: "비정사", undecided: "미정" }[d.canon_status] || "미정")}${d.author_id ? tag(label(d.author_id)) : ""}</div></div><div class="actions">${button("작품 정보", "edit-document", d.id, "ghost small")}${button("삭제", "delete-document", d.id, "danger small")}</div></div><div class="writing-layout"><aside class="chapter-list"><div class="list-heading"><strong>목차</strong>${button("+ 장", "new-chapter", d.id, "ghost small")}</div><button class="chapter-row ${!c ? "selected" : ""}" data-action="select-chapter" data-id="">${d.kind === "book" ? "서문 · 전체 메모" : "본문"}</button>${chapters.map((ch) => `<div class="chapter-item"><button class="chapter-row ${ch.id === c?.id ? "selected" : ""}" style="padding-left:${ch.parent_id ? 24 : 12}px" data-action="select-chapter" data-id="${ch.id}">${ch.parent_id ? "↳ " : ""}${h(ch.name)}</button><div class="chapter-controls">${button("↑", "chapter-up", ch.id, "ghost small")}${button("↓", "chapter-down", ch.id, "ghost small")}${button("⋯", "edit-chapter", ch.id, "ghost small")}</div></div>`).join("")}<div class="writing-note">자동 저장되는 원고<br><span>장·절을 자유롭게 구성하고<br>이전 버전으로 돌아갈 수 있습니다.</span></div></aside><div class="writing-editor"><div class="editor-toolbar"><strong>${h(c?.name || (d.kind === "book" ? "서문 · 전체 메모" : "본문"))}</strong><div class="actions"><span id="word-count" class="muted">${body.length.toLocaleString()}자</span>${button("지금 저장", "save-manuscript", d.id, "small ghost")}<a data-export="true" class="button small ghost" href="/api/documents/${d.id}/export?format=md${c ? "&chapter_id=" + c.id : ""}" download>Markdown ↓</a><a data-export="true" class="button small ghost" href="/api/documents/${d.id}/export?format=txt${c ? "&chapter_id=" + c.id : ""}" download>TXT ↓</a></div></div><textarea id="manuscript" class="manuscript" aria-label="원고 본문" data-document="${d.id}" data-chapter="${c?.id || ""}" placeholder="첫 문장부터, 당신의 이야기를 시작하세요.\n\n작성한 원고는 잠시 후 자동 저장됩니다.">${h(body)}</textarea><p class="manuscript-status muted">자동 저장 · 외전의 설정은 본편 데이터에 자동 반영되지 않습니다.</p>${draftRecovery((c ? "chapter:" : "document:") + (c?.id || d.id))}</div></div><div class="detail-sections">${referenceSection(d.id)}${historySection(c ? "chapters" : "documents", c?.id || d.id)}</div>`;
}
function trashView() {
  const rows = [
    "entities",
    "groups",
    "relations",
    "states",
    "documents",
    "chapters",
  ].flatMap((collection) =>
    (db[collection] || [])
      .filter((x) => x.deleted_at)
      .map((x) => ({ ...x, collection })),
  );
  return (
    header(
      "RECOVERY",
      "휴지통",
      "삭제한 자료와 연결을 복원할 수 있습니다. 다른 기록은 연쇄 삭제되지 않습니다.",
    ) +
    `<section class="panel"><div class="panel-body">${rows.map((x) => `<div class="link-row"><div><strong>${h(x.name || x.attribute || relNames[x.type] || "관계")}</strong><small>${x.collection} · ${date(x.deleted_at)}</small></div>${button("복원", "restore-item", x.collection + ":" + x.id, "ghost small")}</div>`).join("") || empty("휴지통이 비어 있습니다", "삭제한 자료는 이곳에서 다시 복구할 수 있습니다.")}</div></section>`
  );
}
function render() {
  setMainContext(normalizeMainContext(db,mainContext()));
  if (ui.tab === "main" && ui.view === "background") ui.view = "spaces";
  disposeAtlas?.();
  disposeAtlas = undefined;
  persist();
  $("#app").innerHTML = shell();
  const page = $("#page");
  if (ui.view === "overview") page.innerHTML = overview();
  else if (ui.view === "atlas") {
    page.innerHTML = header("WORLD ARCHIVE / SPACE", "3D 우주 지도", "기존 자료를 읽기 전용으로 탐색합니다.", button("← 공간 목록", "view", "spaces", "ghost")) + '<div id="atlas-root"></div>';
    const all = active("entities"), scoped = scopedEntities(db,all,mainContext()), spaces = all.filter(e=>["space","planet"].includes(e.kind));
    const ancestors = withSpaceAncestors(spaces,scoped.filter(e=>["space","planet"].includes(e.kind)));
    const ids = new Set([...scoped,...ancestors].map(e=>e.id));
    disposeAtlas = mountAtlas($("#atlas-root"), all.filter(e=>ids.has(e.id)), active("relations"));
  }
  else if (ui.view === "groups") page.innerHTML = groupsView();
  else if (ui.view === "timeline") {
    page.innerHTML = timelineView();
    safe(loadTimeline)();
  } else if (["story", "book"].includes(ui.view)) page.innerHTML = writing();
  else if (ui.view === "trash") page.innerHTML = trashView();
  else page.innerHTML = archive();
  if (ui.tab === "main") page.insertAdjacentHTML("afterbegin",peopleNavigation());
  if (db.meta?.migration_status === "backup_missing") {
    page.insertAdjacentHTML("afterbegin", `<section class="migration-notice" role="status"><div><strong>기존 자료 이전 대기</strong><p>이 주소에는 아직 기존 작업실의 백업을 가져오지 않았습니다. 기존 자료와 미저장 초안은 자동으로 옮겨지지 않습니다.</p></div><button class="button ghost small" data-action="backup">백업 가져오기</button></section>`);
  }
  bindForms();
  bindMainForms();
}
function openDialog(title, html, onSubmit, submit = "저장", wide = false) {
  const dialog = $("#dialog");
  dialog.classList.toggle("wide-dialog", wide);
  dialog.innerHTML = `<form id="dialog-form"><div class="dialog-head"><h2>${title}</h2><button type="button" data-action="close-dialog" aria-label="닫기">×</button></div><div class="dialog-body">${html}</div><div class="dialog-actions"><button type="button" class="button ghost" data-action="close-dialog">취소</button><button type="submit" class="button primary">${submit}</button></div></form>`;
  $("#dialog-form").onsubmit = safe(async (ev) => {
    ev.preventDefault();
    const submitButton = $("button[type=submit]", dialog);
    submitButton.disabled = true;
    try {
      await onSubmit(new FormData(ev.target), ev.target);
      dialog.close();
    } finally {
      submitButton.disabled = false;
    }
  });
  if (!dialog.open) dialog.showModal();
}
function defaultKind() {
  return (
    {
      character: "character",
      organization: "organization",
      civilization: "civilization",
      event: "event",
      spaces: "space",
      setting: "setting",
      generations: "title",
      thought: "thought",
      thinker: "thinker",
    }[ui.view] || "character"
  );
}
function newEntity(kind = defaultKind()) {
  const key = "new:" + kind;
  const draft = localDrafts[key];
  const e = draft || { name: "", kind, description: "", data: kind === "title" ? {generation_id:ui.mainGeneration} : kind === "event" ? {title_id:ui.mainTitle || null} : {} };
  openDialog(
    "새 " + names[kind],
    `<div class="form-grid">${entityFields(e)}</div>`,
    async (_, form) => {
      const body = readEntity(form);
      if (!body.name) throw new Error("이름을 입력하세요.");
      const result = await api("/entities", "POST", body);
      delete localDrafts[key];
      draftsPersist();
      await refresh(false);
      ui.selected = result.id;
      render();
      toast("새 자료를 기록했습니다.");
    },
    "자료 만들기",
    true,
  );
  restoreRaw($("#dialog-form"), draft?.raw);
  $("#dialog-form").addEventListener("input", () => {
    const form = $("#dialog-form");
    try {
      localDrafts[key] = { ...readEntity(form), raw: rawForm(form) };
    } catch {
      localDrafts[key] = { ...localDrafts[key], raw: rawForm(form) };
    }
    draftsPersist();
  });
}
function relationEditor(id, existing) {
  const r = existing || { source_id: id, type: "related", data: {} };
  const all = [...active("entities"), ...active("documents")];
  openDialog(
    existing ? "관계 수정" : "자료 관계 연결",
    `<div class="form-grid">${field("보내는 자료", `<select name="source_id" required>${options(all, r.source_id, "선택하세요")}</select>`)}${field("받는 자료", `<select name="target_id" required>${options(all, r.target_id, "선택하세요")}</select>`)}${field(
      "관계 유형",
      `<input name="type" list="relation-types" value="${h(r.type)}" required><datalist id="relation-types">${Object.entries(
        relNames,
      )
        .map(([v, n]) => `<option value="${v}">${n}</option>`)
        .join(
          "",
        )}</datalist><small class="muted">appearance 작품 등장 / membership 집단 소속 / galaxy_master 갤럭시 마스터 / governs 통치·조율. 새 유형도 직접 입력할 수 있습니다.</small>`,
    )}${field("역할·직위", input("role", r.data?.role, "작품별 역할, 조직 내 직위"))}${field("관계 설명", textarea("note", r.data?.note), true)}${field("통치·조율 관계의 동시 성립", `<select name="exclusive">${option("true", "배타적 · 중첩 시 충돌 표시", r.data?.exclusive === false ? "false" : "true")}${option("false", "공동 관계 · 여러 문명 동시 허용", r.data?.exclusive === false ? "false" : "true")}</select>`, true)}</div><details open><summary>시작 시점</summary>${timeFields("start", r.start)}</details><details><summary>종료 시점 (없으면 미정)</summary>${timeFields("end", r.end)}</details>`,
    async (fd) => {
      const end = readTime(fd, "end");
      const body = {
        source_id: fd.get("source_id"),
        target_id: fd.get("target_id"),
        type: fd.get("type"),
        start: readTime(fd, "start"),
        end: end.mode === "unknown" && !end.label ? null : end,
        data: {
          ...r.data,
          role: fd.get("role"),
          note: fd.get("note"),
          exclusive: fd.get("exclusive") !== "false",
        },
      };
      await mutate(
        "/relations" + (r.id ? "/" + r.id : ""),
        r.id ? "PATCH" : "POST",
        body,
      );
    },
    "관계 저장",
    true,
  );
}
function stateEditor(id, existing) {
  const s = existing || { entity_id: id, attribute: "", value: "", data: {} };
  openDialog(
    existing ? "상태 기록 수정" : "시대별 상태 기록",
    `<p class="callout">현재 기록을 덮어쓰지 않고 적용 시점과 함께 새로운 변화를 기록합니다.</p><div class="form-grid">${field("변화 속성", input("attribute", s.attribute, "예: 활동지 / 나이 / 가치관 / 생존 상태", "required"))}${field("속성 값", input("value", s.value, "이 시점에서의 상태", "required"))}${field("배타적 상태 여부", `<select name="exclusive">${option("true", "동시에 하나만 유효 (충돌 감지)", s.data?.exclusive === false ? "false" : "true")}${option("false", "동시에 여러 값 허용", s.data?.exclusive === false ? "false" : "true")}</select>`, true)}</div><details open><summary>시작 시점</summary>${timeFields("start", s.start)}</details><details><summary>종료 시점</summary>${timeFields("end", s.end)}</details>`,
    async (fd) => {
      const end = readTime(fd, "end");
      await mutate(
        "/states" + (s.id ? "/" + s.id : ""),
        s.id ? "PATCH" : "POST",
        {
          entity_id: s.entity_id,
          attribute: fd.get("attribute"),
          value: fd.get("value"),
          start: readTime(fd, "start"),
          end: end.mode === "unknown" && !end.label ? null : end,
          data: { ...s.data, exclusive: fd.get("exclusive") === "true" },
        },
      );
    },
    "변화 기록",
    true,
  );
}
function groupEditor(g = {}) {
  openDialog(
    g.id ? "그룹 수정" : "새 그룹",
    `<div class="form-grid">${field("그룹 이름", input("name", g.name, "", "required"))}${field(
      "상위 그룹",
      `<select name="parent_id">${options(
        active("groups").filter((x) => x.id !== g.id),
        g.parent_id,
        "최상위 그룹",
      )}</select>`,
    )}${field("표시 순서",input("sort_order",g.sort_order??0,"",'type="number"'))}${field("설명", textarea("description", g.description), true)}</div>`,
    async (fd) => {
      await mutate(
        "/groups" + (g.id ? "/" + g.id : ""),
        g.id ? "PATCH" : "POST",
        {
          name: fd.get("name"),
          parent_id: fd.get("parent_id") || null,
          description: fd.get("description"),
          sort_order: Number(fd.get("sort_order") || 0),
        },
      );
    },
  );
}
function membershipDialog(entityId, groupId) {
  openDialog(
    "그룹에 자료 연결",
    `<div class="form-grid">${field("자료", `<select name="entity_id" required>${options(active("entities"), entityId, "자료 선택")}</select>`)}${field("그룹", `<select name="group_id" required>${options(active("groups"), groupId, "그룹 선택")}</select>`)}</div><p class="muted">하나의 자료가 여러 그룹에 동시에 소속될 수 있습니다.</p>`,
    async (fd) => {
      await mutate("/memberships", "POST", {
        entity_id: fd.get("entity_id"),
        group_id: fd.get("group_id"),
      });
    },
  );
}
function docEditor(d) {
  const existing = !!d;
  d = d || {
    kind: ui.view,
    name: "",
    description: "",
    body: "",
    data: {},
    canon_status: "draft",
  };
  openDialog(
    existing ? "작품 정보 수정" : d.kind === "book" ? "새 사상집" : "새 외전",
    `<div class="form-grid">${field("제목", input("name", d.name, "", "required"))}${field(
      "저자 캐릭터",
      `<select name="author_id">${options(
        active("entities").filter((x) => x.kind === "character"),
        d.author_id,
        "저자 미정",
      )}</select>`,
    )}${field("집필 상태", input("status", d.status || "초안", "기획 / 초안 / 집필 중 / 완성"))}${field(
      "설정 상태",
      `<select name="canon_status">${[
        ["draft", "초안"],
        ["confirmed", "확정"],
        ["noncanon", "비정사"],
        ["undecided", "미정"],
      ]
        .map(([v, n]) => option(v, n, d.canon_status))
        .join("")}</select>`,
    )}${field("소개·기획 의도", textarea("description", d.description), true)}${field("서적 유형", input("book_type", d.data?.book_type, "철학서 / 자기계발서 / 기타"))}${field("구성 메모", textarea("notes", d.data?.notes), true)}</div><details><summary>세계관 내 집필 시점·배경 시간대</summary>${timeFields("time", d.data?.time)}</details><p class="callout">외전의 초안과 책 속 주장은 공통 세계관 데이터를 자동으로 변경하지 않습니다.</p>`,
    async (fd) => {
      const body = {
        kind: d.kind,
        name: fd.get("name"),
        description: fd.get("description"),
        author_id: fd.get("author_id") || null,
        status: fd.get("status"),
        canon_status: fd.get("canon_status"),
        data: {
          ...d.data,
          book_type: fd.get("book_type"),
          notes: fd.get("notes"),
          time: readTime(fd, "time"),
        },
      };
      const result = await api(
        "/documents" + (d.id ? "/" + d.id : ""),
        existing ? "PATCH" : "POST",
        body,
      );
      ui.selected = result.id;
      ui.chapter = null;
      await refresh();
      toast("작품 정보를 저장했습니다.");
    },
    "저장",
    true,
  );
}
function chapterEditor(ch) {
  const d = db.documents.find((x) => x.id === (ch?.document_id || ui.selected));
  const chapters = active("chapters").filter(
    (x) => x.document_id === d.id && x.id !== ch?.id,
  );
  openDialog(
    ch ? "장·절 관리" : "새 장·절",
    `<div class="form-grid">${field("장·절 제목", input("name", ch?.name, "", "required"))}${field("상위 장 (절인 경우)", `<select name="parent_id">${options(chapters, ch?.parent_id, "독립된 장")}</select>`)}</div>${ch ? `<div class="danger-zone">${button("이 장·절 삭제", "delete-chapter", ch.id, "danger small")}<small>휴지통에서 복원할 수 있습니다.</small></div>` : ""}`,
    async (fd) => {
      const result = await api(
        "/chapters" + (ch ? "/" + ch.id : ""),
        ch ? "PATCH" : "POST",
        {
          document_id: d.id,
          name: fd.get("name"),
          parent_id: fd.get("parent_id") || null,
          ...(!ch ? { body: "", sort_order: chapters.length } : {}),
        },
      );
      ui.chapter = result.id;
      await refresh();
      toast("목차를 저장했습니다.");
    },
  );
}
async function saveManuscript() {
  clearTimeout(documentTimer);
  documentTimer = null;
  const el = $("#manuscript");
  if (!el) return;
  const isChapter = !!el.dataset.chapter,
    id = el.dataset.chapter || el.dataset.document,
    key = (isChapter ? "chapter:" : "document:") + id;
  const record = (isChapter ? db.chapters : db.documents).find(
      (x) => x.id === id,
    ),
    body = el.value;
  if (!localDrafts[key] && record?.body === body) {
    setStatus("모든 변경사항 저장됨");
    return;
  }
  localDrafts[key] = {
    ...localDrafts[key],
    body,
    base_revision: localDrafts[key]?.base_revision ?? record?.revision,
  };
  draftsPersist();
  setStatus("저장 중…");
  pendingWrite = pendingWrite
    .catch(() => {})
    .then(async () => {
      const current = (isChapter ? db.chapters : db.documents).find(
        (item) => item.id === id,
      );
      // An earlier queued save may already have saved this same draft.
      if (!localDrafts[key]) return;
      const revision = localDrafts[key]?.base_revision ?? current?.revision;
      const saved = await api(
        "/" + (isChapter ? "chapters" : "documents") + "/" + id,
        "PATCH",
        { body, revision },
      );
      if (localDrafts[key]?.body === body) delete localDrafts[key];
      else if (localDrafts[key])
        localDrafts[key].base_revision = saved.revision;
      draftsPersist();
      await refresh(false);
      updateDraftRecovery(key);
      if (!$("#manuscript") || $("#manuscript").value === body)
        setStatus("모든 변경사항 저장됨");
    });
  await pendingWrite;
}
function rawForm(form) {
  return Object.fromEntries(new FormData(form).entries());
}
function restoreRaw(form, raw) {
  if (!raw) return;
  for (const [key, value] of Object.entries(raw)) {
    const el = form.elements.namedItem(key);
    if (el && !el.disabled) el.value = value;
  }
}
function draftRecovery(key) {
  return `<div id="draft-recovery" data-key="${h(key)}">${draftRecoveryButtons(key)}</div>`;
}
function draftRecoveryButtons(key) {
  if (!localDrafts[key]) return "";
  return `<div class="actions" style="padding-top:12px"><span class="muted">저장 충돌 또는 미저장 초안 처리</span>${button("서버 내용 사용", "discard-draft", key, "small ghost")}${button("내 초안으로 다시 저장", "rebase-draft", key, "small ghost")}</div>`;
}
function updateDraftRecovery(key) {
  const element = $("#draft-recovery");
  if (element?.dataset.key === key)
    element.innerHTML = draftRecoveryButtons(key);
}
async function resolveDraft(key, discard) {
  if (!localDrafts[key]) return;
  clearTimeout(documentTimer);
  documentTimer = null;
  await pendingWrite.catch(() => {});
  if (!localDrafts[key]) {
    setStatus("모든 변경사항 저장됨");
    return;
  }
  if (discard) {
    if (
      !confirm("이 브라우저의 초안을 버리고 최신 서버 내용을 불러오시겠습니까?")
    )
      return;
    delete localDrafts[key];
    draftsPersist();
    await refresh();
    setStatus("최신 서버 내용을 불러왔습니다.");
    return;
  }
  // Read the latest server revision without replacing the editor's local text.
  await refresh(false);
  const separator = key.indexOf(":"),
    type = key.slice(0, separator),
    id = key.slice(separator + 1),
    collection = {
      entity: "entities",
      document: "documents",
      chapter: "chapters",
    }[type],
    record = db[collection]?.find((item) => item.id === id);
  if (!record || record.deleted_at)
    throw new Error(
      "서버에서 이 자료가 삭제되었습니다. 휴지통에서 복원한 뒤 다시 시도하세요.",
    );
  if (
    !confirm(
      "최신 서버 버전을 확인했습니다. 서버 내용 대신 내 초안을 저장하시겠습니까? 이후 다른 수정이 발생하면 다시 충돌을 표시합니다.",
    )
  )
    return;
  localDrafts[key].base_revision = record.revision;
  draftsPersist();
  if (type === "entity") {
    const form = $("#entity-form");
    if (!form || form.dataset.id !== id) return;
    const payload = readEntity(form, record);
    await api("/entities/" + id, "PATCH", {
      ...payload,
      revision: record.revision,
    });
    delete localDrafts[key];
    draftsPersist();
    await refresh();
    setStatus("모든 변경사항 저장됨");
  } else {
    await saveManuscript();
  }
  toast("명시적으로 선택한 초안을 저장했습니다.");
}
function stashView() {
  ui.viewStates ||= {};
  ui.lastViews ||= {};
  ui.viewStates[ui.view] = Object.fromEntries(
    ["query", "kind", "title", "group", "selected", "chapter", "year"].map(
      (k) => [k, ui[k]],
    ),
  );
  ui.lastViews[ui.tab] = ui.view;
}
async function changeView(view, tab) {
  if (view === "overview" && tab !== "writing") view = "character";
  await flushBeforeNavigation();
  stashView();
  ui.view = view;
  if (["spaces","setting","timeline","atlas"].includes(view)) ui.backgroundOpen = true;
  ui.tab =
    tab ||
    (["story", "book", "thought", "thinker"].includes(view)
      ? "writing"
      : "main");
  Object.assign(
    ui,
    {
      query: "",
      kind: "",
      title: "",
      group: "",
      selected: null,
      chapter: null,
      year: "",
    },
    ui.viewStates?.[view] || {},
  );
  render();
}
async function flushBeforeNavigation() {
  if ($("#manuscript") && documentTimer) {
    await saveManuscript();
  }
  await pendingWrite.catch(() => {});
}
function bindForms() {
  const entityForm = $("#entity-form");
  if (entityForm) {
    const key = "entity:" + entityForm.dataset.id;
    restoreRaw(entityForm, localDrafts[key]?.raw);
    entityForm.addEventListener("input", () => {
      const e = lookup(entityForm.dataset.id),
        raw = rawForm(entityForm),
        base_revision = localDrafts[key]?.base_revision ?? e.revision;
      try {
        localDrafts[key] = { ...readEntity(entityForm, e), raw, base_revision };
        setStatus("미저장 변경사항 · 브라우저 임시 보관");
      } catch {
        localDrafts[key] = { ...localDrafts[key], raw, base_revision };
        setStatus("JSON 입력 중 · 브라우저 임시 보관");
      }
      draftsPersist();
      updateDraftRecovery(key);
      $(".draft-notice").textContent =
        "브라우저에 임시 보관 중입니다. 변경사항을 저장하세요.";
    });
    entityForm.onsubmit = safe(async (ev) => {
      ev.preventDefault();
      const e = lookup(entityForm.dataset.id),
        body = readEntity(entityForm, e),
        revision = localDrafts[key]?.base_revision ?? e.revision;
      await api("/entities/" + e.id, "PATCH", { ...body, revision });
      delete localDrafts[key];
      draftsPersist();
      setStatus("모든 변경사항 저장됨");
      await refresh();
      toast("변경사항을 저장했습니다.");
    });
  }
  const manuscript = $("#manuscript");
  if (manuscript)
    manuscript.addEventListener("input", () => {
      const key =
        (manuscript.dataset.chapter ? "chapter:" : "document:") +
        (manuscript.dataset.chapter || manuscript.dataset.document);
      const record = (
        manuscript.dataset.chapter ? db.chapters : db.documents
      ).find(
        (x) =>
          x.id === (manuscript.dataset.chapter || manuscript.dataset.document),
      );
      localDrafts[key] = {
        ...localDrafts[key],
        body: manuscript.value,
        base_revision: localDrafts[key]?.base_revision ?? record?.revision,
      };
      draftsPersist();
      updateDraftRecovery(key);
      $("#word-count").textContent =
        manuscript.value.length.toLocaleString() + "자";
      setStatus("미저장 변경사항 · 임시 보관 중");
      clearTimeout(documentTimer);
      documentTimer = setTimeout(() => {
        documentTimer = null;
        safe(saveManuscript)();
      }, 800);
    });
  for (const id of ["kind-filter", "title-filter", "group-filter"]) {
    const el = $("#" + id);
    if (el)
      el.onchange = () => {
        ui[
          {
            "kind-filter": "kind",
            "title-filter": "title",
            "group-filter": "group",
          }[id]
        ] = el.value;
        render();
      };
  }
  const search = $("#list-search");
  if (search)
    search.oninput = () => {
      ui.query = search.value;
      const start = search.selectionStart;
      render();
      $("#list-search").focus();
      $("#list-search").setSelectionRange(start, start);
    };
  const global = $("#global-search");
  if (global)
    global.onkeydown = safe(async (ev) => {
      if (ev.key === "Enter") {
        const query = global.value;
        await changeView("archive", "main");
        ui.query = query;
        ui.kind = "";
        ui.title = "";
        ui.group = "";
        render();
      }
    });
}
function profileRaw(form) { return captureFormFields(form); }
function restoreProfileRaw(form, raw) { restoreFormFields(form,raw); }

function updateProfileModes(form) {
  for (const select of $$('[data-profile-mode]',form)) {
    const row=select.closest('[data-profile-key]'), inherited=select.value==="common";
    for(const fieldset of $$('.profile-value fieldset',row)) fieldset.disabled=inherited;
    for(const control of $$('.profile-value input,.profile-value textarea,.profile-value select',row)) control.disabled=inherited;
    $('.profile-source',row).textContent=inherited?"공통 설정 상속":"타이틀별 개별 설정";
  }
}
function readTitleSettings(form) {
  return titleSettingsPayload(new FormData(form).entries(),PROFILE_FIELDS,undefined);
}

function bindMainForms() {
  const title=$('#main-title-select');
  if(title)title.onchange=safe(async()=>{await flushBeforeNavigation();setMainContext({...mainContext(),titleId:title.value});ui.selected=null;render();});
  const common=$('#main-common-toggle');
  if(common)common.onchange=safe(async()=>{await flushBeforeNavigation();ui.includeCommon=common.checked;ui.selected=null;render();});
  const appearance=$('#appearance-form');
  if(appearance) {
    const character=lookup(appearance.dataset.id),key="appearance-checks:"+character.id;
    const snapshot=()=>{
      const previous=localDrafts[key];
      localDrafts[key]={title_ids:new FormData(appearance).getAll('title_ids'),base_revision:previous?.base_revision??character.revision,appearance_revisions:previous?.appearance_revisions??Object.fromEntries(appearancesFor(db,character.id,{includeArchived:true}).map(r=>[r.id,r.revision]))};
      draftsPersist();setStatus("등장 작품 선택 · 브라우저 임시 보관");
    };
    appearance.addEventListener('change',snapshot);
    appearance.onsubmit=safe(async ev=>{
      ev.preventDefault();
      const ids=new FormData(appearance).getAll('title_ids'),removed=detachedAppearances(db,character.id,ids);
      const content=removed.filter(hasAppearanceContent);
      if(removed.length&&!confirm(`등장 연결 ${removed.length}개를 해제하시겠습니까?${content.length?" 작품별 내용이 있는 연결도 삭제하지 않고 보관합니다.":""} 인물과 기존 기록은 유지됩니다.`))return;
      const draft=localDrafts[key];
      await api('/characters/'+character.id+'/appearances','POST',appearanceSelectionPayload(db,character,ids,draft,removed.length>0));
      delete localDrafts[key];draftsPersist();await refresh();setStatus("모든 변경사항 저장됨");toast("등장 작품 연결을 저장했습니다.");
    });
  }
  const profile=$('#title-settings-form');
  if(profile) {
    const key=titleDraftKey(profile.dataset.character,profile.dataset.title),relation=db.relations.find(r=>r.id===profile.dataset.relation);
    restoreProfileRaw(profile,localDrafts[key]?.raw);updateProfileModes(profile);
    const snapshot=()=>{localDrafts[key]={raw:profileRaw(profile),base_revision:localDrafts[key]?.base_revision??relation.revision};draftsPersist();setStatus("작품별 설정 · 브라우저 임시 보관");};
    profile.addEventListener('input',snapshot);
    profile.addEventListener('change',()=>{updateProfileModes(profile);snapshot();});
    profile.onsubmit=safe(async ev=>{
      ev.preventDefault();const body=readTitleSettings(profile),revision=localDrafts[key]?.base_revision??relation.revision;
      await api('/characters/'+profile.dataset.character+'/title-settings/'+profile.dataset.title,'PATCH',{...body,revision});
      delete localDrafts[key];draftsPersist();await refresh();setStatus("모든 변경사항 저장됨");toast("이 작품의 설정을 저장했습니다.");
    });
  }
}
async function reviewTitleDraft() {
  const form=$('#title-settings-form');if(!form)return;
  const characterId=form.dataset.character,titleId=form.dataset.title,key=titleDraftKey(characterId,titleId),payload=readTitleSettings(form);
  localDrafts[key]={raw:profileRaw(form),base_revision:localDrafts[key]?.base_revision??db.relations.find(r=>r.id===form.dataset.relation)?.revision};draftsPersist();
  await refresh(false);
  const character=lookup(characterId),relation=appearanceFor(db,characterId,titleId);
  if(!character||character.deleted_at||!relation)throw new Error('인물 또는 등장 연결이 변경되었습니다. 초안은 보존했습니다. 등장 작품 연결을 확인한 뒤 다시 시도하세요.');
  const current=resolveTitleProfile(character,relation),common=commonProfile(character);
  const rows=PROFILE_FIELDS.map(info=>{
    const intended=Object.hasOwn(payload.overrides,info.key)?payload.overrides[info.key]:payload.inherit_fields.includes(info.key)?common[info.key]:current.values[info.key];
    return `<tr><th>${h(info.label)}</th><td>${h(profileDisplay(current.values[info.key]))}</td><td>${h(profileDisplay(intended))}<small>${payload.inherit_fields.includes(info.key)?"공통 설정 사용":"타이틀별 개별 설정"}</small></td></tr>`;
  }).join('');
  openDialog('작품별 설정 충돌 확인',`<p>${h(label(titleId))}의 최신 저장 내용과 내 초안을 비교하세요. 다른 작품과 공통 설정은 유지됩니다.</p><div class="comparison-scroll"><table class="draft-comparison"><thead><tr><th>항목</th><th>최신 저장 내용</th><th>저장할 내 초안</th></tr></thead><tbody>${rows}</tbody></table></div><label class="checkbox-row"><input type="checkbox" name="confirmed" required> 차이를 확인했으며 이 작품에 내 초안을 저장합니다.</label>`,async()=>{
    await api('/characters/'+characterId+'/title-settings/'+titleId,'PATCH',{...payload,revision:relation.revision});
    delete localDrafts[key];draftsPersist();await refresh();setStatus('모든 변경사항 저장됨');toast('확인한 작품별 초안을 저장했습니다.');
  },'확인한 초안 저장',true);
}
async function reviewAppearanceDraft(characterId) {
  const form=$('#appearance-form');if(!form||form.dataset.id!==characterId)return;
  const ids=new FormData(form).getAll('title_ids'),key='appearance-checks:'+characterId;
  localDrafts[key]={...(localDrafts[key]||{}),title_ids:ids};draftsPersist();
  await refresh(false);
  const character=lookup(characterId);if(!character||character.deleted_at)throw new Error('인물이 삭제되어 연결을 변경할 수 없습니다. 초안은 보존했습니다.');
  const all=appearancesFor(db,characterId,{includeArchived:true}),current=appearancesFor(db,characterId),removed=detachedAppearances(db,characterId,ids);
  const titleFor=r=>r.source_id===characterId?r.target_id:r.source_id;
  openDialog('등장 작품 연결 충돌 확인',`<p>최신 연결과 저장할 선택을 확인하세요. 인물 ID와 공통 설정, 연결 해제되는 작품의 기록은 보존됩니다.</p><div class="overview-grid"><section><h3>최신 저장된 등장 작품</h3><p>${current.map(r=>h(label(titleFor(r)))).join(', ')||'연결 없음'}</p></section><section><h3>저장할 내 선택</h3><p>${ids.map(id=>h(label(id))).join(', ')||'연결 없음'}</p></section></div>${removed.length?`<p class="callout">연결 해제 후 보관할 작품: ${removed.map(r=>h(label(titleFor(r)))+(hasAppearanceContent(r)?' (작품별 내용 보관)':'')).join(', ')}</p>`:''}<label class="checkbox-row"><input type="checkbox" name="confirmed" required> 최신 연결과 차이를 확인했으며 내 선택을 저장합니다.</label>`,async()=>{
    await api('/characters/'+characterId+'/appearances','POST',{title_ids:ids,revision:character.revision,appearance_revisions:Object.fromEntries(all.map(r=>[r.id,r.revision])),confirm_detach:removed.length>0});
    delete localDrafts[key];draftsPersist();await refresh();setStatus('모든 변경사항 저장됨');toast('확인한 등장 작품 연결을 저장했습니다.');
  },'확인한 연결 저장',true);
}

async function reorderGroupMember(id,direction) {
  const current=db.memberships.find(m=>m.id===id),members=sorted(active('memberships').filter(m=>m.group_id===current.group_id)),index=members.findIndex(m=>m.id===id),other=members[index+direction];
  if(!other)return;
  for(let i=0;i<members.length;i++)await api('/memberships/'+members[i].id,'PATCH',{sort_order:(i===index?index+direction:i===index+direction?index:i)*10,revision:members[i].revision});
  await refresh();
}

async function deleteEntity(id) {
  const e = lookup(id);
  const impact = await api("/entities/" + id + "/impact");
  const refs = impact.references || impact.refs || impact;
  openDialog(
    "자료를 휴지통으로 이동",
    `<p><strong>${h(e.name)}</strong>을(를) 삭제하시겠습니까?</p><p class="muted">연결과 다른 작품은 연쇄 삭제하지 않습니다. 자료를 복원하면 기존 ID와 연결이 유지됩니다.</p><details open><summary>영향받는 참조 확인</summary>${
      Array.isArray(refs)
        ? refs
            .map((ref) => {
              const record = ref.record || ref;
              return `<div class="link-row"><strong>${h(record.name || label(record.entity_id || record.source_id) || "연결 기록")}</strong><span>${h({ entities: "세계관 자료", relations: "자료 관계", memberships: "그룹 소속", states: "상태 기록", documents: "원고", chapters: "장·절" }[ref.collection] || ref.collection || "참조")}</span></div>`;
            })
            .join("") || '<p class="muted">연결된 참조가 없습니다.</p>'
        : '<p class="muted">연결된 참조를 유지합니다.</p>'
    }</details>`,
    async () => {
      await mutate("/entities/" + id, "DELETE");
      ui.selected = null;
      render();
    },
    "휴지통으로 이동",
  );
}
async function mergeDialog(id) {
  const e = lookup(id);
  const others = active("entities").filter(
    (x) => x.id !== id && x.kind === e.kind,
  );
  openDialog(
    "중복 자료 병합",
    `${field("유지할 자료", `<input value="${h(e.name)}" disabled>`)}${field("이 자료로 병합할 원본", `<select name="source_id" id="merge-source" required>${options(others, "", "대상을 선택하세요")}</select>`)}<div id="merge-preview"><p class="muted">병합 전 충돌 필드와 영향을 받는 연결을 확인하세요.</p></div><p class="callout">원본 참조는 유지할 자료의 ID로 연결됩니다. 병합된 원본은 휴지통에 보관됩니다.</p><label class="checkbox-row"><input name="confirmed" type="checkbox" required> 필드와 연결을 확인했으며 병합에 동의합니다.</label>`,
    async (fd) => {
      const source = fd.get("source_id");
      if (!source) throw new Error("병합할 자료를 선택하세요.");
      const choices = {};
      for (const [k, v] of fd.entries())
        if (k.startsWith("choice:")) choices[k.slice(7)] = v;
      await mutate(
        "/entities/" + id + "/merge",
        "POST",
        { source_id: source, field_choices: choices, confirm: true },
        "자료와 참조를 병합했습니다.",
      );
    },
    "병합 실행",
    true,
  );
  $("#merge-source").onchange = safe(async (ev) => {
    if (!ev.target.value) return;
    const preview = await api(
      "/entities/" +
        id +
        "/merge-preview?source_id=" +
        encodeURIComponent(ev.target.value),
    );
    $("#merge-preview").innerHTML =
      `<h3>충돌 필드 선택</h3>${(preview.conflicts || []).map(({ field: k, target: a, source: b }) => field(h(k), `<select name="choice:${h(k)}">${option("target", "유지: " + (typeof a === "object" ? JSON.stringify(a) : (a ?? "(비어 있음)")), "target")}${option("source", "원본: " + (typeof b === "object" ? JSON.stringify(b) : (b ?? "(비어 있음)")), "target")}</select>`)).join("")}<details><summary>연결 영향 및 서버 검증 결과</summary><p>병합되는 원본을 참조하는 기록 ${preview.impact?.count ?? preview.impact?.references?.length ?? 0}개가 유지할 자료로 연결됩니다.</p>${(preview.impact?.references || []).map((ref) => `<div class="link-row">${h(ref.record?.name || label(ref.record?.source_id || ref.record?.entity_id) || "관계 기록")}</div>`).join("")}</details>`;
  });
}
function splitDialog(id) {
  const e = lookup(id),
    rels = active("relations").filter(
      (r) => r.source_id === id || r.target_id === id,
    );
  openDialog(
    "자료에서 새 객체 분할",
    `${field("새 자료 이름", input("name", "", "새 객체 이름", "required"))}<p class="muted">선택한 정보와 관계를 새 객체에 복사합니다. 원본 정보와 기존 참조는 그대로 유지됩니다.</p><h3>새 객체로 가져갈 정보</h3>${Object.keys(
      e.data || {},
    )
      .map(
        (k) =>
          `<label class="checkbox-row"><input type="checkbox" name="fields" value="${h(k)}"> ${h(k)} · ${h(JSON.stringify(e.data[k]))}</label>`,
      )
      .join(
        "",
      )}<h3>새 객체에도 연결할 관계</h3>${rels.map((r) => `<label class="checkbox-row"><input type="checkbox" name="relation_ids" value="${r.id}"> ${h(relNames[r.type] || r.type)} · ${h(label(r.source_id === id ? r.target_id : r.source_id))}</label>`).join("") || '<p class="muted">연결된 관계 없음</p>'}`,
    async (fd) => {
      const result = await api("/entities/" + id + "/split", "POST", {
        name: fd.get("name"),
        fields: fd.getAll("fields"),
        relation_ids: fd.getAll("relation_ids"),
      });
      ui.selected = result.id || result.entity?.id || id;
      await refresh();
      toast("원본을 보존하고 새 객체를 만들었습니다.");
    },
    "분할 실행",
    true,
  );
}
function backupDialog() {
  openDialog(
    "데이터 백업 및 복원",
    `<div class="backup-bar"><h3>전체 아카이브 내보내기</h3><p>설정, 관계, 시점별 기록, 원고와 버전 이력을 JSON 파일에 보관합니다.</p><a class="button primary" href="/api/backup" download="the-myth-backup.json">전체 백업 다운로드 ↓</a></div><h3>백업에서 복원</h3>${field("백업 JSON 파일", '<input type="file" name="backup_file" accept="application/json,.json" required>')}${field("복원 방식", '<select name="mode"><option value="merge">안전하게 합치기 · 중복 ID가 충돌하면 중단</option><option value="replace">전체 교체 · 현재 데이터의 사전 백업 후 복원</option></select>')}<label class="checkbox-row"><input type="checkbox" name="confirm" required> 파일의 내용과 복원 방식을 확인했습니다.</label><p class="muted">전체 교체는 현재 데이터에 영향을 줍니다. 먼저 백업을 다운로드하세요.</p>`,
    async (fd) => {
      const file = fd.get("backup_file");
      if (!file?.size) throw new Error("백업 파일을 선택하세요.");
      const backup = JSON.parse(await file.text());
      await mutate(
        "/backup/restore",
        "POST",
        {
          backup,
          mode: fd.get("mode"),
          confirm: fd.get("mode") === "replace" ? "REPLACE" : null,
        },
        "백업을 복원했습니다.",
      );
    },
    "선택한 백업 복원",
    true,
  );
}
async function reorder(collection, id, direction) {
  const list =
    collection === "chapters"
      ? sorted(
          active("chapters").filter(
            (x) =>
              x.document_id ===
              db.chapters.find((c) => c.id === id)?.document_id,
          ),
        )
      : ui.view === "timeline"
        ? sorted(active("entities").filter((x) => x.kind === "event"))
        : collection === "entities" && lookup(id)?.kind === "title"
          ? titlesForGeneration(db,lookup(id).data?.generation_id)
          : collection === "entities" && lookup(id)?.kind === "generation"
            ? catalogGenerations(db)
            : entityList();
  const i = list.findIndex((x) => x.id === id),
    other = list[i + direction];
  if (!other) return;
  const thisOrder = Number(list[i].sort_order) || 0,
    otherOrder = Number(other.sort_order) || 0;
  if (thisOrder === otherOrder) {
    for (let j = 0; j < list.length; j++)
      await api("/" + collection + "/" + list[j].id, "PATCH", {
        sort_order: j * 10,
      });
    await api("/" + collection + "/" + id, "PATCH", {
      sort_order: (i + direction) * 10,
    });
    await api("/" + collection + "/" + other.id, "PATCH", {
      sort_order: i * 10,
    });
  } else {
    await api("/" + collection + "/" + id, "PATCH", { sort_order: otherOrder });
    await api("/" + collection + "/" + other.id, "PATCH", {
      sort_order: thisOrder,
    });
  }
  await refresh();
}
document.addEventListener(
  "click",
  safe(async (ev) => {
    const exporter = ev.target.closest("[data-export]");
    if (exporter) {
      ev.preventDefault();
      await saveManuscript();
      const response = await fetch(exporter.href);
      if (!response.ok) throw new Error("원고 내보내기에 실패했습니다.");
      const url = URL.createObjectURL(await response.blob()),
        a = document.createElement("a");
      a.href = url;
      a.download =
        (lookup(ui.selected)?.name || "원고") +
        (exporter.href.includes("format=md") ? ".md" : ".txt");
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return;
    }
    const b = ev.target.closest("[data-action]");
    if (!b) return;
    ev.preventDefault();
    const id = b.dataset.id,
      action = b.dataset.action;
    if (action === "close-dialog") {
      $("#dialog").close();
      return;
    }
    if (action === "toggle-background") {
      ui.backgroundOpen=!ui.backgroundOpen;persist();
      const menu=$('#background-navigation');if(menu)menu.hidden=!ui.backgroundOpen;
      b.setAttribute('aria-expanded',String(ui.backgroundOpen));const arrow=$('.nav-chevron',b);if(arrow)arrow.textContent=ui.backgroundOpen?'⌃':'⌄';
      return;
    }
    if (action === "select-generation") {
      await flushBeforeNavigation();setMainContext(normalizeMainContext(db,{...mainContext(),generationId:id,titleId:null}));ui.selected=null;render();return;
    }
    if(action === "setup-catalog") {
      await flushBeforeNavigation();const result=await api('/catalog/reconcile','POST',{});await refresh();toast(result.created_ids?.length?'세대와 타이틀을 등록했습니다.':'기존 세대와 타이틀을 확인했습니다.');return;
    }
    if(action === "open-title-slot") {
      await flushBeforeNavigation();const [characterId,titleId]=id.split("|");ui.tab="main";ui.view="character";ui.selected=characterId;ui.characterSlots||={};ui.characterSlots[characterId]=titleId;setMainContext(contextForEntity(db,lookup(titleId),mainContext()));render();return;
    }
    if(action === "character-slot") {
      await flushBeforeNavigation();const [characterId,titleId]=id.split('|');ui.characterSlots||={};ui.characterSlots[characterId]=titleId;render();return;
    }
    if(action === "rebase-title-draft")return reviewTitleDraft();
    if(action === "rebase-appearance-draft")return reviewAppearanceDraft(id);
    if(action === "discard-appearance-draft") {
      const key="appearance-checks:"+id;
      if(localDrafts[key]&&!confirm("미저장 등장 작품 선택을 버리고 저장된 연결을 불러오시겠습니까?"))return;
      delete localDrafts[key];draftsPersist();await refresh();return;
    }
    if(action === "discard-title-draft") {
      if(!confirm('이 슬롯의 브라우저 초안을 버리고 저장된 설정을 불러오시겠습니까?'))return;
      delete localDrafts[id];draftsPersist();await refresh();return;
    }
    if(action === "new-event-relation")return eventRelationEditor(id);
    if(action === "new-generation")return newEntity('generation');
    if(action === "group-member-up" || action === "group-member-down")return reorderGroupMember(id,action === "group-member-up"?-1:1);
    if (action === "home") return changeView("character", "main");
    if (action === "tab")
      return changeView(
        ui.lastViews?.[id] || (id === "main" ? "character" : "story"),
        id,
      );
    if (action === "view" || action === "quick") return changeView(id);
    if (action === "select") {
      await flushBeforeNavigation();
      ui.selected = id;
      render();
      return;
    }
    if (action === "select-doc") {
      await flushBeforeNavigation();
      ui.selected = id;
      ui.chapter = null;
      render();
      return;
    }
    if (action === "select-chapter") {
      await flushBeforeNavigation();
      ui.chapter = id || null;
      render();
      return;
    }
    if (action === "open") {
      await flushBeforeNavigation();
      const e = lookup(id);
      if (!e) return;
      ui.selected = id;
      ui.chapter = null;
      ui.query = "";
      ui.kind = "";
      ui.group = "";
      ui.title = "";
      if (e.kind === "story" || e.kind === "book") {
        ui.tab = "writing";
        ui.view = e.kind;
      } else {
        ui.tab = ["thought", "thinker"].includes(e.kind) ? "writing" : "main";
        ui.view = ["character","event","setting"].includes(e.kind) ? e.kind : e.kind === "civilization" ? "civilization" : e.kind === "organization" ? "organization" : ["space","planet"].includes(e.kind) ? "spaces" : ["title","generation"].includes(e.kind) ? "generations" : "archive";
        if (ui.tab === "main") setMainContext(contextForEntity(db,e,mainContext()));
        if (["spaces","setting","timeline","atlas"].includes(ui.view)) ui.backgroundOpen = true;
      }
      render();
      return;
    }
    if (action === "title-filter") {
      await changeView("archive", "main");
      setMainContext({...mainContext(),titleId:id,generationId:generationForTitle(db,id)?.id||ui.mainGeneration});
      ui.query = "";
      ui.kind = "";
      ui.group = "";
      render();
      return;
    }
    if (action === "clear-filter") {
      ui.query = "";
      ui.kind = "";
      ui.title = "";
      ui.group = "";
      render();
      return;
    }
    if (action === "new-entity") return newEntity();
    if (action === "new-event") return newEntity("event");
    if (action === "delete-entity") return deleteEntity(id);
    if (action === "new-relation") return relationEditor(id);
    if (action === "edit-relation")
      return relationEditor(
        null,
        db.relations.find((x) => x.id === id),
      );
    if (action === "delete-relation") {
      if (
        confirm("이 관계를 해제하시겠습니까? 연결된 자료는 삭제되지 않습니다.")
      )
        await mutate("/relations/" + id, "DELETE");
      return;
    }
    if (action === "new-state") return stateEditor(id);
    if (action === "edit-state")
      return stateEditor(
        null,
        db.states.find((x) => x.id === id),
      );
    if (action === "delete-state") {
      if (confirm("상태 기록을 휴지통으로 이동하시겠습니까?"))
        await mutate("/states/" + id, "DELETE");
      return;
    }
    if (action === "new-group") return groupEditor();
    if (action === "edit-group")
      return groupEditor(db.groups.find((x) => x.id === id));
    if (action === "delete-group") {
      if (confirm("그룹을 삭제하시겠습니까? 소속 자료는 삭제되지 않습니다."))
        await mutate("/groups/" + id, "DELETE");
      return;
    }
    if (action === "add-membership") return membershipDialog(id);
    if (action === "group-add-entity") return membershipDialog(null, id);
    if (action === "remove-membership") {
      await mutate(
        "/memberships/" + id,
        "DELETE",
        undefined,
        "그룹에서만 제거했습니다. 원본 자료는 유지됩니다.",
      );
      return;
    }
    if (action === "load-timeline") {
      ui.year = $("#timeline-year").value;
      if (ui.tab === "main" && $("#timeline-title")) setMainContext({...mainContext(),titleId:$("#timeline-title").value,generationId:generationForTitle(db,$("#timeline-title").value)?.id||ui.mainGeneration});
      else if (ui.tab !== "main") ui.title = $("#timeline-title").value;
      persist();
      render();
      return;
    }
    if (action === "reset-time") {
      ui.year = "";
      if (ui.tab !== "main") ui.title = "";
      render();
      return;
    }
    if (action === "new-document") return docEditor();
    if (action === "edit-document")
      return docEditor(db.documents.find((x) => x.id === id));
    if (action === "delete-document") {
      if (confirm("작품과 원고를 휴지통으로 이동하시겠습니까?")) {
        await flushBeforeNavigation();
        await mutate("/documents/" + id, "DELETE");
        ui.selected = null;
        render();
      }
      return;
    }
    if (action === "new-chapter") return chapterEditor();
    if (action === "edit-chapter")
      return chapterEditor(db.chapters.find((x) => x.id === id));
    if (action === "delete-chapter") {
      if (confirm("이 장·절을 휴지통으로 이동하시겠습니까?")) {
        await flushBeforeNavigation();
        await mutate("/chapters/" + id, "DELETE");
        ui.chapter = null;
        $("#dialog").close();
        render();
      }
      return;
    }
    if (action === "save-manuscript") {
      await saveManuscript();
      toast("원고를 저장했습니다.");
      return;
    }
    if (action === "discard-draft" || action === "rebase-draft")
      return resolveDraft(id, action === "discard-draft");
    if (action === "chapter-up" || action === "chapter-down") {
      await flushBeforeNavigation();
      return reorder("chapters", id, action === "chapter-up" ? -1 : 1);
    }
    if (action === "reorder-up" || action === "reorder-down")
      return reorder("entities", id, action === "reorder-up" ? -1 : 1);
    if (action === "restore-version") {
      if (
        confirm("이 버전으로 복원하시겠습니까? 현재 내용도 이력에 보관됩니다.")
      ) {
        await flushBeforeNavigation();
        await mutate(
          "/versions/" + id + "/restore",
          "POST",
          {},
          "이전 버전으로 복원했습니다.",
        );
      }
      return;
    }
    if (action === "restore-item") {
      const separator = id.indexOf(":"),
        collection = id.slice(0, separator),
        itemId = id.slice(separator + 1);
      await mutate(
        "/" + collection + "/" + itemId + "/restore",
        "POST",
        {},
        "휴지통의 자료를 복원했습니다.",
      );
      return;
    }
    if (action === "merge") return mergeDialog(id);
    if (action === "split") return splitDialog(id);
    if (action === "backup") {
      await flushBeforeNavigation();
      return backupDialog();
    }
  }),
);
document.addEventListener(
  "keydown",
  safe(async (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key === "s") {
      ev.preventDefault();
      if ($("#title-settings-form")) $("#title-settings-form").requestSubmit();
      else if ($("#manuscript")) await saveManuscript();
      else if ($("#entity-form")) $("#entity-form").requestSubmit();
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.key === "k") {
      ev.preventDefault();
      $("#global-search")?.focus();
    }
  }),
);
window.addEventListener("beforeunload", (ev) => {
  if (Object.keys(localDrafts).length) {
    ev.preventDefault();
    ev.returnValue = "";
  }
});
try {
  await refresh();
} catch (e) {
  $("#app").innerHTML =
    `<div class="empty"><h1>The Myth</h1><h2>아카이브에 연결할 수 없습니다.</h2><p>${h(e.message)}</p><button class="button primary" onclick="location.reload()">다시 연결</button><p>브라우저에 임시 보관된 편집 내용은 유지됩니다.</p></div>`;
}
