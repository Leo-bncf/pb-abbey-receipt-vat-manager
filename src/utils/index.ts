import { wsPath } from '@/lib/workspace';

// Page URL inside the current book (PB Abbey, or /carnas/... for Carnas).
export function createPageUrl(pageName: string) {
    return wsPath('/' + pageName.replace(/ /g, '-'));
}
