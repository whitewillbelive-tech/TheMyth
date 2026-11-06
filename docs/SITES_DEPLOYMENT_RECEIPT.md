# THE MYTH — Sites 배포 검증 결과

검증일: 2026-11-06 (KST)

**Sites 등록·소유자 전용 비공개 배포·운영 접속·저장 재접속 검증 완료. 원본 사용자 데이터 이전은 백업 미확보로 대기 중.**

| 항목 | 결과 |
| --- | --- |
| Site | THE MYTH |
| 운영 URL | https://younggo-the-myth.whitewillbelive.chatgpt.site/ |
| project_id | appgprj_6aedb2ae0c208191ab014ed6d81f2125 |
| 최종 배포 | 버전 2, succeeded |
| version_id | appgprj_6aedb2ae0c208191ab014ed6d81f2125~appgver_f021121dc9708191b4fffd5c31fe9a3f |
| deployment_id | appgdep_6aedb684ca3c81918c8cc128874aec78 |
| 접근 범위 | custom, owner 1명, 추가 사용자·편집자·그룹 0 |
| Sites 소스 커밋 | 72a17c75ff8dba34c6b4db9a89688f3007a44c79 |
| 동일 소스 GitHub 커밋 | 970df540a2f952e043addb2a56c223062da512ca, work 브랜치 |
| 일치 확인한 Git tree | 5041f4185c1c54df7fe72947dc5e3addd44c2e62 |
| 보존 기준 | a8bae5dcefc44942621d3df291ce42ac60af6038 |
| 최신 Codex 인계 | 382a606fe6e38aa8daf12a9996273c9745b79195 |
| 원본 Python 시험 | 25/25 PASS |
| Sites API 시험 | 28/28 PASS |
| 연대기 비교 | Python과 무작위 120건 일치 |
| D1 | DB 바인딩과 기존 10개 테이블을 운영 조회로 확인 |
| R2 | BUCKET 바인딩, 전체 교체 복원 전 안전 백업 지원 |

## 실제 브라우저 검증

로컬 D1 미리보기에서 본편/외전+사상집 전환, 인물 생성·수정·재접속, 저자와 서적 연결, 서문 자동 저장, 장 생성과 본문 저장을 확인했다.

운영 URL에서도 별도 검증용 외전을 생성하여 본문을 저장했다. 운영 D1의 documents 행에서 본문과 revision=2를 확인하고, 브라우저 새로고침 뒤 동일 본문을 확인했다. 검증 후 해당 원고는 휴지통으로 이동했다(deleted_at 기록 확인). 사용자 작품으로 혼동하지 않도록 제목에 배포 검증용을 명시했고 비정사로 설정했다. 현재 활성 원고는 0개이며 검증용 원고 1개와 그 이력이 휴지통에 남아 있다.

최종 화면 검증에서 CSS route 변환 문제를 발견하여 기존 CSS/JS를 정적 자산으로 제공하도록 수정했다. 버전 2 운영 화면에서 기존 레이아웃·색상·글꼴과 386개 스타일 규칙의 로드를 확인했다. 데이터 초기화 없이 재배포했다.

## 소스 동기화 방식

일반 GitHub push는 `fatal: could not read Username for 'https://github.com': No such device or address`로 실패했다. 연결된 GitHub API의 tree/commit/ref 갱신으로 복구했고, expected_sha로 work 분기를 보호했다. Sites와 GitHub 커밋 SHA는 작성 경로 때문에 다르지만 Git tree SHA가 정확히 일치한다. GitHub main은 변경하지 않았다.

이 문서는 배포 후 결과를 기록하는 문서 전용 후속 커밋이며 실행 코드 변경은 없다. 후속 개발 시 두 원격을 자동 동기화로 가정하지 말고 [SITES_CONNECTION.md](SITES_CONNECTION.md)를 따른다.

## 완료하지 않은 항목

원본 `/workspace/TheMyth-private-backups/20261106T104222Z/` 및 `20261106T104222Z-private-transfer.tar.gz`가 이 환경에 없어 실제 사용자 데이터 이전은 수행하지 않았다. 원본 8개 초기 객체도 임의 재생성하지 않았다. 현재 화면의 '기존 자료 이전 대기'는 이 상태를 정확히 표시한다.

기존 Codex 환경의 최신 비공개 백업 패키지와 manifest/checksum 또는 앱의 `the-myth-backup.json`을 확보해야 한다. 원본 origin의 미저장 초안도 별도 보존한 후 복제 검증→가져오기→재내보내기 비교를 수행해야 이전 완료로 판정할 수 있다.
