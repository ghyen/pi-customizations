# Global AGENTS.md

모든 프로젝트에 적용되는 전역 규칙입니다.

## 작업 방식

- 1분 넘게 걸리는 작업은 bg_run으로 백그라운드 실행하고 계속 진행한다.
- 여러 단계 작업은 시작할 때 todo에 기록하고 끝날 때마다 갱신한다.

## 메모리 쓰기 (주입 캡)

세션 시작 시 자동 주입되는 캡을 넘으면 **앞부분이 잘려 사라진다.** 실측: `MEMORY.md` 4,000 chars, `daily/<날짜>.md` 각 3,000 chars(뒤에서 3,000만 주입).

- `memory_write(long_term)`은 **1~3줄 색인**만. 상세는 `~/.pi/agent/memory/archive/<slug>.md`에 쓰고 `→ archive/<slug>.md`로 가리킨다(qmd가 인덱싱해 `memory_search`로 찾힌다).
- `memory_write(daily)`는 **5줄 이내**. 긴 분석은 프로젝트 문서나 archive로 보낸다.

## 서브에이전트 위임

### 라우팅

| 에이전트 | 사용 시점 |
|---|---|
| `explore` | 파일 3개 이상을 읽어야 구조·흐름·의존성을 파악할 때 |
| `plan` | 구현 전에 단계 분해와 리스크 정리가 필요할 때 |
| `code-review` | 수정 diff를 버그·보안·성능 관점에서 검토할 때 |
| `backend-dev` | 백엔드 구현 + 테스트 검증까지 필요할 때 |
| `frontend-dev` | 프론트 구현 + typecheck·lint·build 검증까지 필요할 때 |
| `fullstack-dev` | API 계약 자체가 바뀌어 양 계층을 함께 고쳐야 할 때 |

호출은 **전부 background가 기본**이다(pi-subagents `asyncByDefault` 기본 true). 즉시 리턴하고, 완료되면 세션이 깨어나므로 대기·폴링하지 않는다. 결과를 같은 턴에서 꼭 받아야 하는 경우에만 `async: false`를 쓴다.

정의 파일은 `~/.pi/agent/agents/*.md`이고, 추론 강도는 frontmatter `thinking:`으로 지정한다. 모드는 frontmatter에 없다(호출 파라미터다).

추가로 builtin 에이전트 13개가 기본 제공된다: `scout`, `researcher`, `evidence-auditor`, `worker`, `reviewer`, `oracle`, `delegate` 등. 그중 `reviewer`·`scout`는 프로젝트 컨텍스트를 상속하므로(`inheritProjectContext=true`) 프로젝트 규칙을 이미 읽는다.

### 판단 기준

- 위임이 직접 처리보다 싸다. 실측: 첫 턴 컨텍스트가 서브 3,200토큰 vs 오케스트레이터 17,000토큰, 턴당 비용 $0.00048 vs $0.00136. 오케스트레이터가 직접 하면 여러 작업의 도구 출력이 한 컨텍스트에 누적되어 매 턴 재지불된다.
- 예외는 1~2턴짜리 초단기 작업이다. 서브 첫 턴 콜드 스타트가 본 작업보다 클 수 있다.
- 병렬과 순차는 토큰 차이가 없다. 각 서브가 독립 세션이라 합산 토큰이 같다. 병렬의 이득은 wall-clock이다.
- 같은 파일을 두 에이전트가 동시에 수정하게 하지 않는다. 독립적인 조사·검증만 병렬로 돌린다.
- `fullstack-dev`가 도는 동안 같은 파일 집합에 `backend-dev`·`frontend-dev`를 투입하지 않는다.

### context로 넘길 것

서브에이전트는 이 파일과 프로젝트 `AGENTS.md`를 읽지 않는다(pi-subagents 기본값: `inheritProjectContext=false`, `inheritGlobalContext=false`). 저장소에서 추론할 수 없는 규칙은 `task` 문자열에 함께 명시해 전달한다. `context` 파라미터는 `fresh|fork|profile` 세션 모드라서 규칙 전달에 쓸 수 없다.

- 테스트·빌드·린트 명령 (정확한 문자열)
- 관련 파일 경로와 계층 경계 (건드리면 안 되는 곳)
- 프로젝트 컨벤션 (네이밍, 에러 처리, 상태 관리 방식)
- 이번 작업의 완료 조건

### 보고 받은 뒤

- 서브에이전트는 commit하지 않는다. 커밋은 오케스트레이터가 한다.
- 보고의 "실행한 검증 명령과 결과"를 그대로 신뢰하지 말고 핵심 주장은 직접 재확인한다.
- 여러 서브의 결과가 충돌하면 파일을 직접 읽어 판정한다.
