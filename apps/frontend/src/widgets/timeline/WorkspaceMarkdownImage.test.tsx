import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import type {Run} from '../../entities/run';
import {MarkdownAnswer} from './Timeline';

const run=(value:Partial<Run>={}):Run=>({id:'run',messageId:'message',agent:'agent',harnessInstanceId:'local-hermes',harnessType:'hermes',modelId:'sol',modeId:null,status:'streaming',text:'',tools:[],...value});

describe('workspace images in agent markdown',()=>{
  it('shows a placeholder while the response streams',()=>{const html=renderToStaticMarkup(<MarkdownAnswer text="![Chart](workspace:charts/result.png)" run={run()}/>);expect(html).toContain('Изображение появится');expect(html).not.toContain('/preview')});
  it('renders the pinned preview and caption after completion',()=>{const attachment={version_id:'version',entry_id:'entry',path:'charts/result.png',name:'result.png',size:10,mime_type:'image/png',url:'/version',preview_url:'/version/preview'},html=renderToStaticMarkup(<MarkdownAnswer text="![Performance](workspace:charts/result.png)" run={run({status:'completed',embeds:[{kind:'image',path:'charts/result.png',status:'resolved',attachment}]})}/>);expect(html).toContain('src="/version/preview"');expect(html).toMatch(/class="[^"]*markdown-image[^"]*"/);expect(html).toContain('<figcaption>Performance</figcaption>')});
  it('does not hotlink external Markdown images',()=>{const html=renderToStaticMarkup(<MarkdownAnswer text="![Remote](https://example.com/wide.png)" run={run({status:'completed'})}/>);expect(html).toContain('Изображение не сохранено в workspace');expect(html).not.toContain('<img');expect(html).not.toContain('src="https://example.com/wide.png"')});
  it('renders a local error instead of failing the answer',()=>{const html=renderToStaticMarkup(<MarkdownAnswer text="![Missing](workspace:missing.png)" run={run({status:'completed',embeds:[{kind:'image',path:'missing.png',status:'error',error:'not_found'}]})}/>);expect(html).toContain('Не удалось показать изображение');expect(html).toContain('файл не найден')});
});
