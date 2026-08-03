import {CircleAlert} from 'lucide-react';
import styles from './RunFailureNotice.module.css';

type FailurePresentation={title:string;description:string;guidance?:string;action?:{label:string;href:string}};

const knownFailures:Record<string,FailurePresentation>={
  provider_region_opt_in_required:{title:'Model requires additional setup',description:'This model requires China hosting to be enabled in OpenCode Go.',guidance:'Enable it in the OpenCode Go workspace settings, then run the agent again.',action:{label:'Open OpenCode workspace settings',href:'https://opencode.ai/workspace'}},
  provider_authentication_failed:{title:'Provider authentication failed',description:'The model provider rejected the configured credentials.',guidance:'Check the provider credentials in OpenCode, then run the agent again.'},
  provider_rate_limited:{title:'Provider rate limit reached',description:'The provider is not accepting more requests right now.',guidance:'Wait a moment, then run the agent again.'},
  provider_quota_exceeded:{title:'Provider quota exhausted',description:'The provider account has no available quota.',guidance:'Check its plan or credits, then run the agent again.'},
  provider_model_unavailable:{title:'Model unavailable',description:'The selected model is not available from the provider.',guidance:'Choose another model or refresh the harness catalog.'},
  provider_unavailable:{title:'Provider unavailable',description:'The model provider could not complete the request.',guidance:'Wait a moment, then run the agent again.'},
};

export function RunFailureNotice({errorCode,error}:{errorCode?:string;error?:string}){
  const known=errorCode?knownFailures[errorCode]:undefined;
  const presentation:FailurePresentation=known??{title:'Could not complete',description:error||'An unexpected error prevented the agent from responding.'};
  return <section className={styles.notice} role="alert" aria-live="polite">
    <CircleAlert aria-hidden="true"/>
    <span><strong>{presentation.title}</strong><p>{presentation.description}</p>{presentation.guidance&&<small>{presentation.guidance}</small>}{presentation.action&&<a href={presentation.action.href} target="_blank" rel="noreferrer">{presentation.action.label}</a>}</span>
  </section>;
}
