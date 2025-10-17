import type { MeteorBase } from '../Meteor';
import type DDP from '../../lib/ddp';

import { VentConstants } from './constants';
import VentClientSubscription, {
  type VentSubscriptionClient,
} from './VentClientSubscription';

type VentStore = Record<string, VentClientSubscription>;
type DdpMessage = Record<string, unknown>;

class VentClient implements VentSubscriptionClient {
  private store: VentStore = {};
  private ddp: DDP | null = null;
  private onChangedHandler: ((message: DdpMessage) => void) | null = null;
  private meteor: MeteorBase | null = null;

  attach(ddp: DDP) {
    if (!ddp) {
      throw new Error('Vent requires a DDP instance');
    }

    if (this.ddp === ddp && this.onChangedHandler) {
      return;
    }

    this.detachListener();
    this.attachListener(ddp);
  }

  reset() {
    this.detachListener();
    this.store = {};
  }

  subscribe(name: string, ...args: unknown[]) {
    this.ensureInitialized();

    const meteor = this.requireMeteor();
    const subscription = new VentClientSubscription(this, meteor, name);
    this.add(subscription);

    return subscription.subscribe(...args);
  }

  add(subscription: VentClientSubscription) {
    this.store[subscription.id] = subscription;
  }

  remove(subscription: VentClientSubscription) {
    delete this.store[subscription.id];
  }

  setMeteor(meteor: MeteorBase) {
    this.meteor = meteor;
  }

  private requireMeteor(): MeteorBase {
    if (!this.meteor) {
      throw new Error('Vent is not configured');
    }

    return this.meteor;
  }

  private attachListener(ddp: DDP) {
    this.onChangedHandler = (message: DdpMessage) => {
      const isVentMessage = message[VentConstants.PREFIX] === '1';
      if (!isVentMessage) {
        return;
      }

      const subscription = this.store[message.id as string];
      if (subscription) {
        subscription.handle(message[VentConstants.EVENT_VARIABLE]);
      }
    };

    ddp.on('changed', this.onChangedHandler as any);
    this.ddp = ddp;
  }

  private detachListener() {
    if (this.ddp && this.onChangedHandler) {
      if (typeof this.ddp.off === 'function') {
        this.ddp.off('changed', this.onChangedHandler as any);
      } else if (typeof (this.ddp as any).removeListener === 'function') {
        (this.ddp as any).removeListener(
          'changed',
          this.onChangedHandler as any
        );
      }
    }

    this.ddp = null;
    this.onChangedHandler = null;
  }

  private ensureInitialized() {
    if (!this.ddp || !this.onChangedHandler) {
      throw new Error('Vent is not initialized');
    }
  }
}

const ventClient = new VentClient();

const Vent = {
  configure(meteor: MeteorBase) {
    ventClient.setMeteor(meteor);
  },
  attach(ddp: DDP) {
    ventClient.attach(ddp);
  },
  reset() {
    ventClient.reset();
  },
  subscribe(name: string, ...args: unknown[]) {
    return ventClient.subscribe(name, ...args);
  },
};

export default Vent;
