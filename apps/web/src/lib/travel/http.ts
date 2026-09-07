import { after } from 'next/server';
import { runTravelBackgroundWork } from './schedule';

export function wakeTravelWorker(): void { after(runTravelBackgroundWork); }
