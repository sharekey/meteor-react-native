import type { MeteorBase } from '../Meteor';

import Random from '../../lib/Random';
import { VentConstants } from './constants';

type EventHandler = (event: unknown) => void;

export interface VentSubscriptionClient {
  add(subscription: VentClientSubscription): void;
  remove(subscription: VentClientSubscription): void;
}

type SubscriptionHandle = ReturnType<MeteorBase['subscribe']>;

class VentClientSubscription {
  private readonly client: VentSubscriptionClient;
  private readonly meteor: MeteorBase;
  private readonly name: string;
  private readonly subscriptionId: string;
  private eventHandler?: EventHandler;

  constructor(
    client: VentSubscriptionClient,
    meteor: MeteorBase,
    name: string
  ) {
    this.client = client;
    this.meteor = meteor;
    this.name = name;
    this.subscriptionId = Random.id();
  }

  get id(): string {
    return VentConstants.getPrefix(this.subscriptionId, this.name);
  }

  subscribe(...args: unknown[]) {
    const handler = this.meteor.subscribe(
      this.name,
      this.subscriptionId,
      ...args
    );

    const originalStop = handler.stop.bind(handler);
    Object.assign(handler, {
      listen: (eventHandler: EventHandler) => {
        if (typeof eventHandler !== 'function') {
          throw new Error('You should pass a function to listen()');
        }

        this.eventHandler = eventHandler;
      },
      stop: () => {
        this.client.remove(this);
        return originalStop();
      },
    });

    return handler as SubscriptionHandle & {
      listen(eventHandler: EventHandler): void;
    };
  }

  handle(event: unknown) {
    if (this.eventHandler) {
      this.eventHandler(event);
    }
  }
}

export default VentClientSubscription;
