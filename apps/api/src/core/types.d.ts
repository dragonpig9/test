import type { Ctx } from './context';

declare global {
  namespace Express {
    interface Request {
      ctx: Ctx;
    }
  }
}
export {};
