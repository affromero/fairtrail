import { after } from 'next/server';
import { runTravelJobsSafely } from './schedule';

export function wakeTravelWorker(): void { after(runTravelJobsSafely); }
