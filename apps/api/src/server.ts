import { createApp } from './app';
import { env } from './config/env';

createApp().listen(env.port, () => {
  console.log(`CommonHours API listening on http://localhost:${env.port} (demo mode: ${env.demoMode}, debug endpoints: ${env.debugEndpoints})`);
});
