# Pi 사용자 맞춤 설정

현재 Pi 환경의 확장, subagent 정의, 관련 설정 예시를 모은 공개 저장소입니다. 전체 `~/.pi/agent` 복사본은 아니며, 인증 정보와 실행 기록은 포함하지 않습니다.

## 포함 항목

- `extensions/` — 활성화된 로컬 TypeScript 확장 11개. `orca-*` 확장은 Orca host 환경이 있을 때만 동작합니다.
- `profile/agents/` — `pi-subagents`용 agent 정의 6개.
- `profile/AGENTS.md`, `profile/APPEND_SYSTEM.md` — 개인 전역 지침. 다른 환경에 적용하기 전에 내용을 검토하세요.
- `config/settings.json.example` — 현재 모델 선택, thinking 기본값, npm package 선언 등의 예시.
- `config/enabled-models.json` — MiMo-V2.6-Flash와 DeepSeek V4.1 Flash 선택 ID.
- `config/spark.json`, `config/web-search.json`, `config/pi-openai-fast.json` — 관련 package 설정.

## 확장 설치

```sh
pi install git:github.com/ghyen/pi-customizations
```

그 다음 `/reload`를 실행하거나 Pi를 다시 시작하세요. `settings.json.example`의 package 목록은 별도로 기존 `~/.pi/agent/settings.json`에 병합하고, 필요하면 다음 명령으로 package를 설치·갱신하세요.

```sh
pi update --extensions
```

## 프로필과 package 설정 복원

필요한 파일만 대상 환경으로 복사하고, 기존 파일은 무조건 덮어쓰지 말고 병합하세요.

- `profile/AGENTS.md`와 `profile/APPEND_SYSTEM.md` → `~/.pi/agent/`
- `profile/agents/*.md` → `~/.pi/agent/agents/`
- `config/spark.json`, `config/web-search.json` → `~/.pi/agent/`
- `config/pi-openai-fast.json` → `~/.pi/agent/extensions/`
- `config/enabled-models.json` → 기존 `settings.json`의 `enabledModels` 배열에 병합

모델 ID는 대상 provider의 catalog와 인증이 있어야 선택할 수 있습니다. 각 환경에서 `/login`으로 별도 인증하세요.

## 제외 항목

`auth.json`, `models.json`의 환경별 header, `models-store.json` catalog cache, sessions, memory, MCP cache, 로그, trust 정보와 백업 파일은 올리지 않았습니다. 비밀값이나 개인 세션을 이 저장소에 추가하지 마세요.
