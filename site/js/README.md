# JavaScript architecture

`main.js` is the composition root. It creates the runtime systems, wires their
dependencies and keeps the frame order explicit.

- `controllers/` — user-facing state machines and application workflows.
- `simulation/` — deterministic boat, vessel and wave-domain logic.
- `rendering/` — scene environment, ocean and GPU-oriented visual systems.
- `fauna/` — wildlife construction, behavior and shared fauna math.
- `ui/` — HUD, onboarding and achievement presentation.
- `runtime/` — cross-cutting browser services such as audio, loading and quality.

Modules use direct imports instead of barrel exports so dependencies remain
visible and browser startup does not evaluate unrelated subsystems.
