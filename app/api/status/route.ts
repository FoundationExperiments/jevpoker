import { service } from '@/lib/server';
export function GET() {
  return service.status();
}
