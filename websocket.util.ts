import { generateRandomID } from '@utils/generateRandomId.util';

const DEFAULT_POLLING_DELAY = 3000; // default interval for pollingCallback in milliseconds;
const DEFAULT_FIXED_POLLING_DELAY = 20000; // default interval for pollingCallback in milliseconds;

export class Subscription {
  private id = '';
  private client: any = null;
  private topicId = '';
  private subscription: any = null;
  private pollingCallback: any = () => false;
  private pollingDelay: number = DEFAULT_POLLING_DELAY;
  private fallbackPollingDelay: number = DEFAULT_FIXED_POLLING_DELAY;
  private onMessageCallback: any;
  private onUnsubscribe: any;

  constructor(
    client: any,
    topicId: string,
    options: ISubscribeOptions,
    onUnsubscribe: any
  ) {
    this.client = client;
    this.topicId = topicId;
    this.pollingCallback = options?.pollingCallback;
    this.pollingDelay = options?.pollingDelay || DEFAULT_POLLING_DELAY;
    this.fallbackPollingDelay =
      options?.fallbackPollingDelay || DEFAULT_FIXED_POLLING_DELAY;
    this.onUnsubscribe = onUnsubscribe;
    this.id = generateRandomID();
    this.subscribe();
  }

  private onMessageHandler(message: any) {
    if (message?.body && this?.onMessageCallback) {
      this.onMessageCallback(message.body);
    }
  }

  onMessage(onMessageCallback: any) {
    this.onMessageCallback = onMessageCallback;
  }

  setClientAndSubscribe(client: any) {
    this.client = client;
    this.subscribe();
  }

  getClient() {
    return this.client;
  }

  getTopicId() {
    return this.topicId;
  }

  async startPolling() {
    if (this.pollingCallback) {
      setTimeout(async () => {
        if (!this.client?.connected) {
          const isPollAgain = await this.pollingCallback();
          if (isPollAgain) {
            this.startPolling();
          } else {
            this.unsubscribe();
          }
        }
      }, this.pollingDelay);
    }
  }

  private async fallbackPolling() {
    if (this.pollingCallback) {
      setTimeout(async () => {
        if (this.client?.connected && this.subscription) {
          const isPollAgain = await this.pollingCallback();
          if (isPollAgain) {
            this.fallbackPolling();
          } else {
            this.unsubscribe();
          }
        }
      }, this.fallbackPollingDelay);
    }
  }

  subscribe() {
    if (this.client && this.client.connected) {
      this.subscription = this.client.subscribe(
        `/topic/${this.topicId}`,
        this.onMessageHandler.bind(this)
      );
      this.fallbackPolling();
    }
  }

  unsubscribe() {
    if (this.client && this.client.connected) {
      this.subscription?.unsubscribe();
    }
    this.onUnsubscribe(this.id);
  }

  getId() {
    return this.id;
  }
}

export interface ISubscribeOptions {
  pollingCallback?: () => boolean;
  pollingDelay?: number;
  fallbackPollingDelay?: number;
}
