import { env } from 'cloudflare:workers';
import { GameService } from './poker/service';
const bindings = env as unknown as Record<string, string | undefined>;
const runtime = globalThis as typeof globalThis & {
  jevpokerService?: GameService;
};
export const service = (runtime.jevpokerService ??= new GameService({
  apiKey: bindings.TYPESAFE_API_KEY,
  model: bindings.JEV_MODEL || 'jev-latest',
  baseUrl: bindings.TYPESAFE_BASE_URL || 'https://api.typesafe.ai',
}));
