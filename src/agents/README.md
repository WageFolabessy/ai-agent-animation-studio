# Spec-Then-Compile Studio Orchestration (`src/agents/`)

This directory implements the Spec-Then-Compile LLM Orchestration and Self-Healing Validation Pipeline:

- **`types.ts`**: Shared interfaces (`LlmProvider`, `LlmOptions`, `AcousticSummary`, `OrchestrationOptions`, `OrchestrationResult`).
- **`llm-provider.ts`**:
  - `extractJsonFromLlmResponse`: Strips UTF-8 BOM, markdown code fences (` ```json ... ``` `), and surrounding prose.
  - `OpenAiCompatibleProvider`: Provider-agnostic HTTPS/localhost client for OpenAI, Gemini, Groq, and Ollama.
  - `DeterministicMockLlmProvider`: 100% offline deterministic provider for unit tests, CI, and benchmarks.
- **`story-spec-agent.ts`**: `StorySpecAgent` synthesizing song-conditioned narrative specification (`StorySpecContract`), cast definitions, section arcs, and beat boundaries from musical features and lyrics.
- **`orchestrator.ts`**: `StudioAgentOrchestrator` coordinating the canonical Spec-Then-Compile pipeline with automated self-healing retry loops powered by `compileStorySpecToStoryboard`, `ArchetypeFactory`, `solveChoreography`, and contract invariants.
- **`repair-helper.ts`**: Diagnostics helper providing localized subtree extraction (`extractSubtreeAtPath`), JSON path token parsing, and focused schema repair prompt formatting for large drafts.
