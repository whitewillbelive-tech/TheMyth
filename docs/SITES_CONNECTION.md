# THE MYTH — Sites 연결 및 후속 개발

## 동일 프로젝트 식별

- Site 이름: `THE MYTH`
- Site project_id: `appgprj_6aedb2ae0c208191ab014ed6d81f2125`
- Site 주소: `https://younggo-the-myth.whitewillbelive.chatgpt.site`
- 접근 범위: 소유자 개인 전용 (`custom`, owner 1명, 추가 사용자/그룹 없음)
- 원본 GitHub: `https://github.com/whitewillbelive-tech/TheMyth`
- GitHub 개발 브랜치: `work` (`main`은 변경하지 않음)
- 보존 기준: `a8bae5dcefc44942621d3df291ce42ac60af6038`
- 확인한 최신 Codex 인계: `382a606fe6e38aa8daf12a9996273c9745b79195`
- Sites 소스 원격: `https://git.chatgpt-team.site/103add6b-fdc3-4c9a-90ba-068ad369bd54/appgprj_6aedb2ae0c208191ab014ed6d81f2125.git`
- Sites 소스 브랜치: `main` (GitHub의 `main`과 별개)
- 자격증명은 이 문서나 저장소에 보관하지 않는다.

주소는 이 프로젝트의 고정 주소이며, 실제 운영 상태와 배포 버전은 `get_site`/배포 결과로 확인한다.

## 소스 구조

기존 `myth/` Python 구현은 그대로 보존한다. 기존 `web/index.html`, `web/app.js`, `web/styles.css`를 그대로 제공하며, 두 최상위 탭과 전체 편집 UI를 교체하지 않는다. 화면의 추가 변경은 기존 백업 미이전 안내뿐이다.

Sites는 제공된 Vinext/Cloudflare Workers JavaScript 진입점으로 배포한다. `app/route.ts`, `app/app.js/route.ts`, `app/styles.css/route.ts`가 기존 정적 자산을 제공하고, `app/api/[...path]/route.ts`가 기존 API를 `sites/api.js`와 `sites/store.js`에 연결한다. Python Uvicorn 프로세스나 로컬 SQLite 파일을 호스팅에서 실행한다고 가정하지 않는다.

`.openai/hosting.json`의 `DB`는 D1, `BUCKET`은 R2다. 실제 저장소는 Sites가 이 프로젝트에 프로비저닝한다. D1 데이터베이스 ID를 임의로 만들거나 다른 Site의 바인딩을 사용하지 않는다. D1의 8개 업무 컬렉션은 기존 `{id, record JSON}` 구조를 보존한다. `metadata`와 `schema_migrations`도 스키마에 남긴다. Drizzle 마이그레이션 이력은 별도로 관리한다.

동시 쓰기는 D1 원자적 batch와 metadata revision 조건으로 보호한다. 충돌 시 전체 변경을 취소하고 409를 반환한다. 원고 버전·삭제 상태·참조·알 수 없는 확장 필드는 유지한다. 단일 JSON 레코드가 D1 제한에 접근하면 기록을 자르지 않고 413으로 거부한다.

전체 교체 복원 전 현재 상태를 비공개 R2에 보존한다. 백업 실패 시 복원하지 않는다. 응답의 `safety_backup` 파일은 `/api/safety-backups/<파일명>`에서 개인 전용 인증을 거쳐 다운로드할 수 있다.

## 원본 데이터 이전 상태

이 작업 환경에는 인계 문서의 `/workspace/TheMyth-private-backups/20261106T104222Z/`와 비공개 이전 패키지가 없다. 따라서 원본 8개 초기 객체나 그 후 수정분을 가져왔다고 주장하지 않는다. Sites 데이터베이스는 사용자 자료를 임의 재생성하지 않는다. 이전이 완료될 때까지 화면에 안내한다.

기존 환경에서 `20261106T104222Z-private-transfer.tar.gz`와 checksum/manifest 또는 앱의 `the-myth-backup.json`을 비공개로 전달받는다. 실제 전환 때는 최신 백업인지 확인하고 원본 환경의 미저장 `myth-drafts`를 먼저 저장한다. SQLite 파일을 Git에 넣거나 바이너리를 D1 migration으로 실행하지 않는다.

1. 원본 백업의 SHA-256과 manifest를 확인하고 SQLite integrity_check를 검증한다.
2. 복제본과 별도 임시 DB에서 JSON의 8개 컬렉션, ID, payload, 참조, 삭제 이력, 원고, 버전을 비교한다.
3. Site의 **백업 및 복원 → 안전하게 합치기**로 가져온다. 같은 ID가 다르면 중단된다. 전체 교체는 별도 명시 확인과 R2 사전 백업을 거친다.
4. Site에서 다시 전체 백업을 내보내 배열을 비교한다. meta의 내보내기 시간과 호스팅 상태는 업무 레코드 비교에서 제외한다.
5. 실제 원본 비교가 끝나기 전에는 데이터 이전 완료로 보고하지 않는다.

## 후속 Codex 작업 절차

1. 기존 project_id로 `get_site`를 호출하여 소유자 전용 접근과 최신 배포를 확인한다. `create_site`를 다시 호출하지 않는다.
2. `create_source_repository_write_credential`로 같은 프로젝트의 단기 소스 접근을 얻는다. token은 메모리에만 보관하고 source helper stdin으로 전달한다.
3. Sites의 `site-workflow.mjs`로 동일 소스를 열거나 현재 체크아웃과 원격 이력을 대조한다. GitHub `work`와 Sites 원격 `main`은 자동 동기화되지 않는다. 최신 원격을 확인해 충돌 없이 합친다.
4. 기존 UI와 데이터 계약을 유지하며 수정한다. `npm run test:sites`, `node --check web/app.js`, 필요한 Python 회귀 테스트를 수행한다. 스키마 변경은 append-only migration으로 추가한다.
5. Sites build helper로 검증/빌드하고 source helper로 정확한 소스 커밋을 push·패키징한다.
6. 소유자 전용이 확인되면 `save_version_and_deploy_private`를 사용한다. 이미 저장된 버전은 재저장하지 않고 해당 version_id로 배포한다.
7. terminal 성공 상태와 운영 URL을 확인한다. GitHub `work`에도 검증된 같은 커밋을 fast-forward push한다. GitHub `main`을 덮거나 강제 push하지 않는다.
8. 기존 원고의 실제 데이터는 Git 소스와 별개다. 재배포 때 초기화·seed·테스트 데이터 가져오기를 하지 않는다.

## 검증 명령

```bash
npm run test:sites
node --check web/app.js
python3 -m unittest discover -v
```

브라우저 검증은 Sites의 관리형 preview 절차로 수행한다. 기존 `scripts/browser_smoke.py`는 로컬 Python 앱 전용이며 seed ID에 의존하므로, 원본 백업을 아직 가져오지 않은 운영 Site에 그대로 실행하지 않는다.
