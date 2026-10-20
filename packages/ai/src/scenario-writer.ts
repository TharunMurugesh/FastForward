import { parseScenario, type Scenario } from '@fastforward/contracts';
import { AiUnavailableError, MODEL, stripCodeFence, type AiClient } from './client.js';
import { SCENARIO_SYSTEM } from './prompts.js';

const NO_AI = 'AI is switched off or not configured: set ANTHROPIC_API_KEY or write the YAML by hand';

/** Plain English to a validated Scenario. One retry that shows the model its own validation error. */
export async function writeScenario(description: string, ai: AiClient | null): Promise<Scenario> {
  if (!ai) throw new AiUnavailableError(NO_AI);

  const ask = async (prompt: string): Promise<string> => {
    try {
      return stripCodeFence(await ai.complete({ model: MODEL, system: SCENARIO_SYSTEM, prompt, effort: 'medium' }));
    } catch (err) {
      throw new AiUnavailableError(`could not reach the model: ${err instanceof Error ? err.message : String(err)}. Check your network and that ANTHROPIC_API_KEY is valid.`);
    }
  };

  const first = await ask(description);
  try {
    return parseScenario(first);
  } catch (err) {
    const problem = err instanceof Error ? err.message : String(err);
    const second = await ask(
      `${description}\n\nYour previous answer was not a valid scenario:\n${first}\n\nProblem:\n${problem}\n\nReply with the corrected YAML only.`,
    );
    try {
      return parseScenario(second);
    } catch (err2) {
      throw new Error(`the model did not produce a valid scenario after two tries: ${err2 instanceof Error ? err2.message : String(err2)}`);
    }
  }
}
