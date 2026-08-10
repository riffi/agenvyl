// @vitest-environment jsdom

import {cleanup,render,screen} from '@testing-library/react';
import {afterEach,describe,expect,it} from 'vitest';
import {IsolatedHtmlPreview} from './IsolatedHtmlPreview';
import {RuntimeFeaturesProvider} from './RuntimeFeatures';

afterEach(cleanup);

describe('IsolatedHtmlPreview',()=>{
  it('allows pointer lock without relaxing the other sandbox restrictions',()=>{
    render(<RuntimeFeaturesProvider value={{preview_origin:'http://127.0.0.1:8792'}}><IsolatedHtmlPreview previewUrl="/api/v1/rooms/room/runs/run/preview/" title="Preview"/></RuntimeFeaturesProvider>);

    const frame=screen.getByTitle('Preview');
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-pointer-lock');
    expect(frame.getAttribute('src')).toBe('http://127.0.0.1:8792/api/v1/rooms/room/runs/run/preview/');
  });
});
