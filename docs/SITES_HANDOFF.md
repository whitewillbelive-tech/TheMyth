# ChatGPT Sites 이전 준비 및 보존 보고

조사일: 2026-11-06. 목적은 기존 개발 결과물의 안전한 보존과 Work 인계이며, 이번 변경은 문서와 Git 제외 규칙으로 한정합니다. `myth/`, `web/`, 의존성 및 기존 테스트의 구현은 기준 커밋 그대로 유지합니다.

## 소스 및 현재 실행 상태

| 항목 | 확인 결과 |
| --- | --- |
| 저장소 | `whitewillbelive-tech/TheMyth` |
| 실제 체크아웃 | `/workspace/TheMyth`, 브랜치 `work` |
| 보존 기준 커밋 | `a8bae5dcefc44942621d3df291ce42ac60af6038` |
| 시작 시 작업 트리 | 깨끗함. 기존 사용자 변경 사항 없음 |
| 원격 fetch/push | 모두 `https://github.com/whitewillbelive-tech/TheMyth.git` |
| 준비 전 원격 | `main`은 `294c0cea5061870bb9805d6421741641253ae1e7`, `work` 없음 |
| 기존 소스 보존 | 기준 커밋을 원격 `work`에 실제 push 완료. 인계 문서는 별도 후속 커밋으로 같은 브랜치에 반영 |
| 원격 main | 이번 작업에서 변경하지 않음 |
| 테스트 재검증 | 기존 자동 테스트 25/25 PASS, JavaScript 구문 검사 PASS |
| 현재 실행 상태 | 조사 시 `127.0.0.1:8000/api/health` 연결 실패. 기존 서버는 실행 중이 아님. 준비 작업에서 서버를 재시작하거나 배포하지 않음 |

기존 개발 서버는 필요할 때 `cd /workspace/TheMyth` 후 `bash scripts/run.sh`로 시작합니다. 이는 개인용 개발 실행이며 Sites 배포가 아닙니다. 실행 시 기본 DB를 임의로 초기화하지 마세요.

## DB 및 소스 백업

비공개 보존 위치:

```text
/workspace/TheMyth-private-backups/20261106T104222Z/
```

폴더 권한은 0700, 파일 권한은 0600입니다. Git 체크아웃 바깥이며 저장소 추적·GitHub push에 포함되지 않습니다. `20261106T104222Z`는 UTC 기준 생성 시각입니다.

| 파일 | 내용 및 검증 |
| --- | --- |
| `myth.sqlite3` | SQLite 온라인 backup API로 생성한 독립 스냅샷. `integrity_check=ok`, 백업의 journal mode는 DELETE로 정리하여 WAL/SHM 없이 복구 가능 |
| `the-myth-backup.json` | 전역 객체·관계·그룹·소속·상태·원고·장절·버전 8개 컬렉션. 임시 DB로 전체 복원하여 원본 배열 일치 확인 |
| `sqlite-full-dump.sql` | 스키마·메타데이터를 포함한 SQLite 전체 dump. D1 가져오기 검증 파일이 아님 |
| `source-all-refs.bundle` | 준비 전 소스 Git 이력과 로컬 refs. `git bundle verify` 및 오프라인 clone의 기준 HEAD 일치 확인 |
| `source-HEAD.tar.gz` | 기준 커밋의 추적 소스 아카이브. 런타임 DB·가상환경 제외 |
| `manifest.json` | 기준 커밋, 테이블별 개수, 복구 검증, 파일별 SHA-256과 크기. 최종 인계 커밋의 보존 자료도 추가 기록 |

최종 인계 커밋을 보존하는 `handoff-all-refs.bundle`과 `handoff-HEAD.tar.gz`도 같은 폴더에 추가합니다. 비공개 전달용 패키지는 폴더 바깥 형제 파일 `20261106T104222Z-private-transfer.tar.gz`와 SHA-256 파일로 보관합니다. 패키지는 공개 업로드하지 마세요.

현재 서버 DB는 전역 객체 8개(확인된 세대·구상 타이틀·우주), 나머지 7개 컬렉션은 0개입니다. 최대 레코드 크기는 331 bytes로 확인했습니다. `metadata`의 초기화 표시와 `schema_migrations`도 native/SQL 백업에 포함됩니다. 이는 서버에 저장된 자료의 현황이며 브라우저 초안이 없다는 증거는 아닙니다.

**브라우저 주의점:** `myth-drafts`와 UI 상태는 기존 origin의 localStorage에 있습니다. DB·JSON 백업에는 들어 있지 않습니다. 실제 전환 전 기존 주소에서 미저장 초안을 서버에 저장하거나 별도 비공개 파일로 보존해야 합니다. 주소 변경 시 자동 이전을 가정하지 마세요.

백업 폴더는 현재 머신에만 있습니다. 새 Work 환경이나 GitHub로 자동 복원되지 않으므로 환경 폐기 전에 사용자에게 비공개 패키지를 전달하고 다른 저장장치에도 보존해야 합니다. 암호화된 원격 백업이나 외부 스토리지 업로드는 이번 작업에서 수행하지 않았습니다.

## GitHub 데이터 보호

- push 전 모든 도달 가능한 Git 이력(기준 시점 2개 커밋, 22개 blob)을 검사했습니다. 런타임 SQLite, 백업, 환경 파일, SQLite binary header 및 알려진 자격증명 패턴이 발견되지 않았습니다. 패턴 검사는 미발견 증거이며 비밀 정보가 절대로 없다는 수학적 보증은 아닙니다.
- `data/`, DB·WAL·SHM·journal, `backups/`, bundle, 앱 JSON/SQL 백업 이름, `.env*`, `.dev.vars*`, `.wrangler/`를 제외합니다. 미래 D1 migration을 위해 모든 `*.sql`을 제외하지는 않습니다.
- 제외 규칙은 이미 추적된 파일을 숨기지 않습니다. 이후에도 `git ls-files`와 staged diff를 검사해야 합니다. 실제 데이터가 실수로 추적되면 push를 중단하고 제거·필요 시 유출 대응을 별도로 수행하세요.
- 원본 SQLite·JSON·SQL 백업이나 토큰 값을 인계 문서에 붙이지 않습니다. GitHub 저장소 공개 여부에 의존하지 않고 DB 자체를 Git 이력에서 배제했습니다.

## Sites 연결 확인 결과

- `.openai/hosting.json`은 현재 checkout 및 기준 커밋에 없습니다. 임의의 파일·project ID·D1 ID·바인딩을 만들지 않았습니다.
- 이 채팅의 사용 가능한 도구에는 Sites 프로젝트 조회·연결·배포 API가 없습니다. 설치된 CLI에서도 해당 연결을 조회할 수 없었습니다.
- `SITES_MANAGED_LINUX_CONTAINER`라는 환경 변수 이름은 현재 머신의 표시일 뿐, 기존 Sites 프로젝트 ID나 대상 배포 런타임을 입증하지 않습니다. 변수 값이나 인증 값을 추출하지 않았습니다.
- 따라서 기존 프로젝트의 존재·연결 여부는 **미확인**입니다. 프로젝트가 없다고 결론 내리지 말고 Work에서 기존 프로젝트를 조회·선택해야 합니다. 파일 스키마와 실제 ID를 받은 뒤 지원되는 절차로만 `.openai/hosting.json`을 연결하세요.

## 현재 기술 스택과 Sites/D1 호환성

| 구성 | 판단 | Work에서 필요한 확인·전환 |
| --- | --- | --- |
| `web/` HTML·CSS·ES module | 재사용 가능 | 정적 자산 경로와 same-origin `/api` 라우팅 유지, 빌드 없이 제공 가능한지 확인 |
| Python 3.12+ / FastAPI | 조건부 | Sites의 실제 Python·ASGI 지원 및 버전 확인. D1 사용만으로 전면 JS 재개발이 필수인 것은 아님 |
| Uvicorn·로컬 포트 | 직접 재사용 미확인 | Sites의 요청 진입점 규약으로 연결. 장기 프로세스·소켓 바인딩을 가정하지 않음 |
| Python Workers 선택지 | Cloudflare 공식 문서상 지원 | Python Workers는 FastAPI/ASGI와 `workers.asgi.entrypoint(app)`를 지원하며 현재 예제는 Python 3.13+. Sites가 이를 제공하는지는 별도 미확인 |
| `sqlite3.connect`·로컬 DB 경로 | D1 직접 대체 불가 | D1 binding/SDK에 대한 저장소 어댑터 필요. `MYTH_DB_PATH`를 D1 ID로 바꾸는 것으로는 동작하지 않음 |
| JSON 기반 테이블·ID·revision | 스키마 재사용 후보 | `json_valid`, `json_extract` 인덱스, UPSERT 등 실제 SQL을 D1 검증 환경에서 확인. 타입·null·이력을 보존 |
| `RLock`·`BEGIN IMMEDIATE` | 분산 환경에 그대로 적용 불가 | 읽기→검증→여러 쓰기의 원자성을 유지. D1 prepared statements와 atomic `batch()`를 이용하고 revision을 SQL 조건부 갱신으로 보호 |
| 파일 기반 복원 전 백업 | 전환 필요 | 요청 런타임의 로컬 파일을 영속 저장으로 간주하지 않음. 지원되는 비공개 저장/다운로드와 D1 복구 방식을 확인 |
| 전체 원고·중첩 버전 스냅샷 | 크기 점검 필요 | D1 공식 행/문자열 제한 2 MB, SQL 문장 100 KB 등을 고려. 큰 원고·버전 분할 설계가 필요할 수 있음 |
| 인증·Origin 검사 | 공개 서비스 전 확인 필요 | 기존 앱은 로컬 개인용이며 인증 없음. Sites의 실제 사용자 인증·데이터 권한·프록시 Origin 규약을 연결 |

권장 분기: Sites에서 Python/ASGI를 제공한다면 기존 FastAPI와 검증 로직을 최대한 보존하고 D1 저장 어댑터 및 진입점을 전환합니다. JS/TS 전용 계약이 확인되면 API·ID·데이터 의미·테스트 시나리오를 유지하면서 서버 어댑터를 포팅합니다. 런타임 확인 전에 어느 쪽도 확정하거나 새 앱을 만들지 마세요.

## D1 데이터 전환 체크리스트 — 이번에는 실행하지 않음

1. 실제 기존 Sites 프로젝트와 해당 프로젝트의 D1 binding 규약을 확인합니다. 원본 DB는 읽기 전용 보관하고 복제본으로 연습합니다.
2. `.sqlite3` 바이너리를 D1에 직접 넣지 않습니다. Cloudflare 공식 절차에 맞춰 SQL로 변환하며 dump의 `BEGIN TRANSACTION`/`COMMIT`과 지원되지 않는 구문을 검토합니다. 현재 `sqlite-full-dump.sql`을 그대로 실행 가능한 D1 migration으로 간주하지 마세요.
3. 모든 컬렉션, soft-deleted 레코드, 관계, ID·revision·timestamp, 장절 계층, 버전 스냅샷, `schema_migrations`와 `metadata.initialized`를 보존합니다. 미확정 시간을 가짜 날짜로 바꾸지 않습니다.
4. 이전 과정에서 행 순서에 의존하지 않습니다. 기존 앱은 일부 `rowid` 순서와 명시적 `sort_order`를 사용하므로 필요한 정렬 규약을 안정화합니다. 전역 객체를 작품별로 복제하지 않습니다.
5. 큰 JSON 값은 SQL 문장·행 제한을 먼저 검사합니다. 임의로 이력을 자르거나 원고를 축약하지 않고, 필요하면 검증 가능한 추가 마이그레이션을 설계합니다.
6. 복제 D1 데이터에서 컬렉션별 개수·ID·JSON payload·참조·원고 본문·버전을 비교합니다. 잘못된 가져오기는 전체 롤백하고 기존 데이터를 덮지 않습니다.
7. 기존 25개 통합 테스트의 의미를 유지해 D1 어댑터에서도 검증합니다. 브라우저 자동 저장·충돌 복구·분할 병합·백업 복구·서적 내보내기를 재실행합니다.
8. 승인된 실제 전환 시점에는 기존 origin의 브라우저 초안과 마지막 DB 변경을 회수하고 쓰기 중지/최종 export, 복제 검증, 되돌리기 절차를 먼저 확정합니다. 사용자의 별도 배포 지시 전에는 cutover나 배포를 실행하지 않습니다.

## 복구 및 롤백 기준

원본 환경은 현재 코드를 그대로 실행할 수 있습니다. 새 런타임 전환이 실패해도 원격 `work`와 비공개 Git bundle에서 기준 커밋을 복구할 수 있습니다. DB는 기존 파일을 덮는 대신 새 경로로 native 스냅샷을 복사해 무결성을 검사한 뒤 `MYTH_DB_PATH`로 지정합니다. 운영 중 DB 파일을 WAL 없이 임의로 복사하거나 기존 데이터를 지우지 마세요.

서버 데이터 JSON 복원은 별도 복제 DB에서 먼저 실행합니다. 기본 병합 모드는 ID 충돌을 덮어쓰지 않으며 전체 교체는 명시적인 선택과 사전 백업이 필요합니다. Work가 바뀌었다는 이유로 실제 기존 데이터를 seed 상태로 되돌리지 마세요.

## 확인한 공식 근거

아래 문서를 2026-11-06에 Cloudflare 공식 문서 저장소(`cloudflare/cloudflare-docs`, production branch)의 허용된 HTTPS 경로로 확인했습니다. 이는 Cloudflare 기능의 근거이며 ChatGPT Sites가 같은 기능을 노출한다는 근거는 아닙니다.

- [Python Workers FastAPI](https://developers.cloudflare.com/workers/languages/python/packages/fastapi/)
- [D1 Database API / batch](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [D1 import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/)
- [D1 SQL statements](https://developers.cloudflare.com/d1/sql-api/sql-statements/)
- [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)

ChatGPT Sites 고유 hosting schema, 실제 프로젝트 ID, 런타임·바인딩 규약은 여전히 Work에서 확인해야 합니다. 이 준비 작업에서는 외부 서비스 생성·DB 가져오기·배포를 수행하지 않았습니다.
