# Multi-Agent LLM Orchestration (`src/agents/`)

This directory implements the Phase 4 Multi-Agent LLM Orchestration and Self-Healing Validation Pipeline:

- **`types.ts`**: Shared interfaces (`LlmProvider`, `LlmOptions`, `AcousticSummary`, `DirectorAgentInput`, `RigAgentInput`, `ChoreographerAgentInput`, `OrchestrationResult`).
- **`llm-provider.ts`**:
  - `extractJsonFromLlmResponse`: Strips UTF-8 BOM, markdown code fences (` ```json ... ``` `), and surrounding prose.
  - `OpenAiCompatibleProvider`: Provider-agnostic HTTPS/localhost client for OpenAI, Gemini, Groq, and Ollama.
  - `DeterministicMockLlmProvider`: 100% offline deterministic provider for unit tests, CI, and benchmarks.
- **`director-agent.ts`**: `DirectorAgent` synthesizing 3-act, 4-shot `DirectorStoryboardContract` with full background rig continuity across all shots.
- **`rig-agent.ts`**: `RigAgent` synthesizing `Map<string, AssetRigContract>` with separated stationary/kinetic particle emitters (`rig-smoke-chimney` vs. `rig-runner-aura`) and anatomical right-facing knee flexion (`[-140, 0]` deg).
- **`choreographer-agent.ts`**: `ChoreographerAgent` synthesizing `ChoreographyContract` with stride-matched $+X$ runner motion and stationary world environment transforms.
- **`orchestrator.ts`**: `StudioAgentOrchestrator` coordinating the sequential multi-agent pipeline with automated self-healing retry loops powered by `validateProjectContracts` and `validateChoreography`.
