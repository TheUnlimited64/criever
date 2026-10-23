// Deterministic subprocess harness for daemon integration and browser tests.
import { runAiCli } from '../src/ai-cli';
const prompt = await Bun.stdin.text();
if (process.env.CRIEVER_AI_REVIEW_ID) {
  process.exit(await runAiCli(['complete']));
}
console.log(`<answer>Private daemon answer from ${process.cwd()}. ${prompt.includes('Conversation:') ? 'Conversation received.' : ''}</answer>`);
