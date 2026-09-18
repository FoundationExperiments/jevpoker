import { service } from '@/lib/server';
export function GET(request: Request) {
  return service.handle(request);
}
export function POST(request: Request) {
  return service.handle(request);
}
