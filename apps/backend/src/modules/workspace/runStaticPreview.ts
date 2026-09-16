import {staticPreviewCandidates} from '@agenvyl/contracts';
export const selectStaticPreviewPath=(paths:string[])=>staticPreviewCandidates(paths)[0];
export const hasUnbuiltWebProject=(paths:string[])=>paths.includes('package.json')&&paths.includes('index.html')&&!selectStaticPreviewPath(paths);
