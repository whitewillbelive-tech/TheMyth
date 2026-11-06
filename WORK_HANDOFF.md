# THE MYTH — Work 인계 시작점

이번 단계는 기존 결과물 보존과 이전 준비까지 완료했으며, 새 Site 생성·D1 생성·가져오기·서비스 배포는 수행하지 않았습니다.

- 저장소: https://github.com/whitewillbelive-tech/TheMyth/tree/work
- 사용할 브랜치: **work**. `main`은 초기 README 커밋이므로 개발 완료 소스가 아닙니다.
- 보존 기준: `a8bae5dcefc44942621d3df291ce42ac60af6038`
- 상세 현황·호환성·백업·전환 순서: [docs/SITES_HANDOFF.md](docs/SITES_HANDOFF.md)
- 기존 실행 방법: [README.md](README.md), 데이터 구조: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 요구사항 원본: [docs/PRODUCT_REQUIREMENTS.md](docs/PRODUCT_REQUIREMENTS.md)

## Work에 전달할 지시문

> `whitewillbelive-tech/TheMyth`의 **work 브랜치**를 열고 `WORK_HANDOFF.md`와 `docs/SITES_HANDOFF.md`부터 읽으세요. 기존 FastAPI·SQLite 앱과 프런트엔드를 재개발하거나 버리지 말고 API·데이터·동작을 보존해 ChatGPT Sites 이전을 이어가세요. 현재 `.openai/hosting.json`이 없고 실제 Sites 프로젝트 연결은 확인되지 않았습니다. 기존 Sites 프로젝트를 조회·선택하여 실제 프로젝트 ID와 지원 런타임·D1 바인딩 규약을 확인하세요. 프로젝트 ID를 만들어 넣거나 새 Site를 중복 생성하지 마세요. 사용자가 별도로 배포를 지시하기 전에는 배포하지 마세요. 원본 DB와 백업을 Git에 추가하지 마세요. 비공개 백업을 안전한 경로로 전달받고 복원 검증한 뒤에만 데이터 전환을 진행하세요. 브라우저 미저장 초안은 DB 백업에 포함되지 않으므로 기존 주소에서 별도로 저장·보존해야 합니다. Sites가 Python/ASGI를 지원하는지 확인한 뒤 최소한의 어댑터 전환을 선택하고, 기존 25개 통합 테스트 및 브라우저 시나리오의 의미를 유지하세요.

## 먼저 확인할 사항

1. Work가 실제 `work` 브랜치를 사용하고 기준 커밋을 포함하는지 확인합니다. 가져오기 기능이 기본 브랜치만 지원한다면 멈추고 브랜치 선택 방법을 확인하세요. `main`을 임의로 덮거나 기본 브랜치를 바꾸지 마세요.
2. 기존 Sites 프로젝트의 실제 ID·연결 상태·런타임을 조회합니다. 현재 채팅에는 프로젝트 조회 도구가 없어 연결 여부를 확정하지 못했습니다. 없는 파일만으로 프로젝트가 없다고 판단하지 마세요.
3. 비공개 백업 패키지를 기존 환경에서 확보합니다. 백업은 이 저장소 바깥에 있으며 GitHub나 새 Work 환경으로 자동 전송되지 않습니다. `manifest.json`과 SHA-256을 검증합니다.
4. 기존 앱을 별도 개발 실행으로 확인하고, D1 전환은 원본 대신 복제 데이터로 검증합니다. 초기 seed를 다시 만들거나 기존 ID·삭제 기록·버전을 버리지 마세요.

인증·권한과 실제 서비스 전환은 후속 작업입니다. 이 준비 작업 자체는 배포 승인으로 간주하지 않습니다.
