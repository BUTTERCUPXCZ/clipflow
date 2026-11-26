# ClipForge AI

Desktop app that turns long-form videos into polished short-form clips (TikTok etc.) using local AI models.

## Docs — read before changing related code

- `doc/architecture.md` — system architecture, components, MVP vs future scope
- `doc/system-design.md` — detailed system design

Read the relevant doc before structural changes, new modules, or pipeline changes. Keep code consistent with them; if code must diverge, update the doc too.

## Code standards — OOP + SOLID, small files

- **Max 300 lines per source file** (tests included; generated code and `components/ui/` excluded). Past that, split by responsibility into a new file. `npm run check:lines` enforces it.
- **Single responsibility:** one class or module does one job. Controllers handle HTTP only, services hold the use-case logic, and repositories own the SQL. A component either fetches data or renders it, not both.
- **Open/closed:** extend through new classes behind an interface instead of editing a growing `if`/`switch`. Examples: health checks are `HealthIndicator` / `HealthCheck` implementations registered in a list; container signatures form a table of matchers.
- **Liskov:** implementations are interchangeable behind their interface; tests substitute fakes through the same interface.
- **Interface segregation:** small interfaces shaped for their consumer (e.g. `ModelRuntime.listModels()`), not "god" services.
- **Dependency inversion:** depend on interfaces and injection tokens, never on concrete infrastructure.
  - NestJS: providers under a token.
  - Python: constructor injection of protocol-typed collaborators.
  - Desktop: one `ApiClient` instance shared by the feature API modules.
- **Per stack:**
  - **NestJS and Python** are class-based: injectable services, repositories, value objects.
  - **React** stays function components and hooks, as React recommends; class components are deprecated. SOLID there means small components, logic in hooks or pure functions, and classes only for non-UI code (API client, errors).
- No abstraction without a second implementation or a test seam that needs it. SOLID serves readability, not ceremony.
