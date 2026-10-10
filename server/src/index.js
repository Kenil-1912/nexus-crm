import 'dotenv/config';
import { createApp } from './app.js';
import { scheduleDailyJobs } from './jobs.js';

const port = Number(process.env.PORT || 4000);
createApp().listen(port, () => console.log(`Nexus CRM API listening on http://localhost:${port}`));
scheduleDailyJobs();
