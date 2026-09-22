# WithAI

WithAI는 AI 참가자와 함께 플레이하는 1인 추리 게임 플랫폼입니다. 게임별 규칙과 상태를 독립된 모듈로 분리해, 현재 제공 중인 마피아 게임 외에도 새로운 추리 게임을 추가할 수 있도록 모노레포 구조로 설계하고 있습니다.

## 프로젝트 현황

| 영역            | 현재 구현                                            |
| --------------- | ---------------------------------------------------- |
| 웹 클라이언트   | React + Vite 기반 게임 클라이언트                    |
| API 서버        | NestJS 기반 서버 Game Session API                    |
| 게임 모듈       | `packages/mafia`의 마피아 게임                       |
| 공통 계약       | `packages/game-contract`의 `GameModule` 계약         |
| AI 참가자       | Google Gemini를 사용하는 서버 측 의사결정 게이트웨이 |
| 실시간 업데이트 | HTTP 명령 + Server-Sent Events                       |
| 세션 영속화     | Redis                                                |
| 웹 배포 설정    | Cloudflare Vite plugin 및 Wrangler 설정              |

## 설계 방향

플랫폼 공통 계층과 게임별 규칙 계층을 분리합니다.

- `packages/game-contract`는 게임 생성과 참가자별 권한 기반 projection을 표현하는 공통 `GameModule` 계약을 정의합니다.
- `packages/mafia`는 해당 계약을 구현하는 현재의 첫 번째 게임 모듈입니다. 마피아의 상태, 역할, 단계, 허용 행동, 정보 공개, 해결 규칙을 소유합니다.
- `apps/api`는 세션 수명주기, 권한 검증, Redis 영속화, 재접속, 이벤트 전달, AI 행동 오케스트레이션을 담당합니다.
- `apps/web`은 공통 세션 경험과 게임별 화면·상호작용을 제공합니다.

현재 API transport와 웹 화면의 일부는 마피아 경로에 특화되어 있습니다. 새로운 게임을 추가할 때는 게임 모듈을 먼저 분리하고, 공통 세션 계층과 게임별 API·화면을 연결하는 방식으로 확장합니다.

## 저장소 구조

```text
apps/
├── api/                  # NestJS API 서버
└── web/                  # React/Vite 웹 클라이언트

packages/
├── game-contract/        # 게임 모듈 공통 계약
├── mafia/                # 현재 마피아 게임 모듈과 규칙 테스트
├── api/                  # 공유 API 타입과 DTO 패키지
├── ui/                   # 공유 UI 컴포넌트와 스타일
├── oxlint-config/        # 공유 Oxlint 설정
└── typescript-config/    # 공유 TypeScript 설정
```

## 로컬 개발

### 사전 요구 사항

- Node.js
- pnpm
- Docker Desktop 또는 Docker Engine
- AI 참가자를 실행할 Google Gemini API 키

### 설치 및 환경 변수

```sh
pnpm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

`apps/api/.env`:

```dotenv
ALLOWED_ORIGIN=http://localhost:5173
GOOGLE_API_KEY=발급받은_Gemini_API_키
REDIS_URL=redis://localhost:6379
```

로컬 Vite 프록시를 사용할 때는 `apps/web/.env`의 `VITE_API_BASE_URL`을 비워 둡니다.

```dotenv
VITE_API_BASE_URL=
```

| 변수                | 위치 | 설명                                             |
| ------------------- | ---- | ------------------------------------------------ |
| `ALLOWED_ORIGIN`    | API  | CORS 허용 출처. 기본값은 `http://localhost:5173` |
| `GOOGLE_API_KEY`    | API  | Gemini AI 참가자 호출에 사용하는 키              |
| `REDIS_URL`         | API  | 게임 세션과 이벤트를 저장할 Redis 연결 URL       |
| `PORT`              | API  | API 포트. 기본값은 `3000`                        |
| `NODE_ENV`          | API  | 운영 환경 동작과 Gemini 모델 선택에 사용         |
| `VITE_API_BASE_URL` | 웹   | API 기본 URL. 로컬 프록시 사용 시 빈 값          |

개발·운영 환경의 API는 Redis를 durable authority로 사용하므로, 실제 게임을 실행하려면 `REDIS_URL`과 Redis가 필요합니다.

### 실행

루트 명령은 Redis 컨테이너를 준비한 뒤 API와 웹 개발 서버를 함께 실행합니다.

```sh
pnpm dev
```

기본 주소:

- 웹: <http://localhost:5173>
- API: <http://localhost:3000>
- 상태 확인: <http://localhost:3000/health>
- API 문서: <http://localhost:3000/docs>

API 문서는 `NODE_ENV=production`이 아닐 때만 노출됩니다. API와 웹을 별도로 실행하려면 다음과 같이 실행합니다.

```sh
docker compose up -d --wait redis
pnpm --filter api dev
pnpm --filter web dev
```

## 주요 명령어

모든 명령은 저장소 루트에서 실행합니다.

| 명령어           | 설명                          |
| ---------------- | ----------------------------- |
| `pnpm dev`       | Redis, API, 웹 개발 서버 실행 |
| `pnpm build`     | 전체 앱과 패키지 빌드         |
| `pnpm test`      | 전체 테스트 실행              |
| `pnpm lint`      | Oxlint 실행                   |
| `pnpm lint:fix`  | Oxlint 자동 수정              |
| `pnpm fmt`       | Oxfmt 실행                    |
| `pnpm fmt:check` | 포맷 검사                     |

워크스페이스별 명령:

```sh
pnpm --filter api test
pnpm --filter web test
pnpm --filter @repo/mafia test
pnpm --filter api build
pnpm --filter web build
```

## API 및 테스트

API의 요청·응답 스키마는 로컬 개발 서버의 [Scalar API Reference](http://localhost:3000/docs)에서 확인할 수 있습니다.

주요 API 영역:

- Game Session 생성·조회·스냅샷
- HTTP 기반 게임 행동 제출
- SSE 기반 순서 보장 이벤트 구독
- 익명 게스트 allowance 및 holder token 관리
- idempotency와 Redis 기반 durable recovery

테스트는 동작 경계에 따라 나뉩니다.

- `apps/api/test/game-sessions/http/`: HTTP 및 SSE 진입점
- `apps/api/test/game-sessions/application/`: 세션 오케스트레이션과 수명주기
- `apps/api/test/game-sessions/agents/`: AI 의사결정과 예약 행동
- `apps/api/test/game-sessions/durability/`: Redis authority, snapshot, recovery, CAS
- `packages/mafia/src/*.test.ts`: 마피아 규칙 모듈

## 새로운 게임 모듈 추가

새 게임을 추가할 때는 다음 경계를 유지합니다.

1. `packages/<game>` 패키지에 게임별 상태와 규칙을 구현합니다.
2. `GameModule` 계약에 맞춰 생성과 권한 기반 projection을 제공합니다.
3. 게임별 역할, 단계, 행동, 정보 공개, 해결 규칙과 테스트를 해당 패키지에 둡니다.
4. API의 세션 계층에 게임 모듈을 연결하고, 필요한 transport를 추가합니다.
5. 웹에 게임별 화면과 상호작용을 추가합니다.

## 라이선스

이 프로젝트는 [MIT License](LICENSE)로 배포됩니다.
