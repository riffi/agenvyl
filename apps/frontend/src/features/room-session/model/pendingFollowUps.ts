import type {Message} from '../../../entities/message';

export const isPendingFollowUp=(message:Message)=>Boolean(
  message.delivery
  &&message.delivery.route!=='room_context'
  &&['queued','dispatching'].includes(message.delivery.status),
);
