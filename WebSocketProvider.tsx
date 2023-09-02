import {
  createContext,
  ReactNode,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react';
import { CompatClient, Stomp } from '@stomp/stompjs';
import { Subscription, ISubscribeOptions } from './webSocket.util';

const noOp = () => {};

export const WebSocketContext = createContext<WebSocketContextType>({
  subscribe: noOp,
  unsubscribe: noOp,
  unsubscribeAll: noOp,
  setUrl: noOp,
  onDisconnect: noOp,
  onBeforeDisconnect: noOp,
  removeLogs: noOp,
});

const DEFAULT_RECONNECTION_DELAY = 5000;
const DEFAULT_RECONNECTION_TRIES = 3;

const promiseArr: any = [];

const resolveAllPromises = () => {
  promiseArr.forEach((res: any) => {
    res();
  });
};

/**
 * WebSocket Provider
 * @param {IWebSocketProvider}
 */
const WebSocketProvider = ({
  children,
  url,
  config,
}: // options, // commeting for now. Will be used when authorization is finalized.
IWebSocketProvider) => {
  const [client] = useState<CompatClient>(
    Stomp.client(url || '', config?.protocols) // need to verify this, might not be required but not sure how to create empty compactclient
  );

  const subscriptionsRef: ISubscriptions = useRef({}); // required for maintaining subscriptions in callbacks
  const disconnectCallback = useRef(noOp);
  const beforeDisconnectCallback = useRef<any>();
  const isFirstConnection = useRef<boolean>(true);
  const clientReconnectionTries = useRef<number>(0);
  const isClientConnectionBroken = useRef<boolean>(false);
  const isPollingActive = useRef<boolean>(false);
  const isClientDisconnectedForced = useRef<boolean>(false);

  const { reconnectDelay, clientMaxReconnectionTries } = useMemo(() => {
    return {
      reconnectDelay: config?.reconnectionDelay || DEFAULT_RECONNECTION_DELAY,
      clientMaxReconnectionTries:
        config?.reconnectionTries || DEFAULT_RECONNECTION_TRIES,
    };
  }, [config]);

  /**
   * Method to check if no subscriptions are active and disconnect client
   * @returns void
   */
  const startAllPollings = useCallback((): void => {
    if (subscriptionsRef.current) {
      if (!isPollingActive.current) {
        isPollingActive.current = true;
        Object.keys(subscriptionsRef.current).forEach((subId) => {
          subscriptionsRef.current[subId].startPolling();
        });
      }
    }
  }, []);

  /**
   * Internal method to be called when client is doconnected
   * */
  const onDisconnectHandler = useCallback(disconnectCallback.current, []); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Method to check if no subscriptions are active and disconnect client
   * @returns void
   */
  const checkAndDisconnectClient = useCallback(
    (topicId: string): void => {
      if (
        subscriptionsRef.current &&
        Object.keys(subscriptionsRef.current).length === 0 &&
        client.connected
      ) {
        isClientDisconnectedForced.current = true;
        if (beforeDisconnectCallback.current && config?.sendMessageUrl) {
          const res = beforeDisconnectCallback.current(topicId);
          client.send(config?.sendMessageUrl, {}, JSON.stringify(res));
        }
        client.disconnect(onDisconnectHandler);
      }
    },
    [client, onDisconnectHandler]
  );

  /**
   * Method to unsubscribe all topics
   * @returns void
   */
  const unsubscribeAll = useCallback((): void => {
    let getLastTopicId = null;
    if (subscriptionsRef.current) {
      const subscriptionKeys = Object.keys(subscriptionsRef.current);
      if (subscriptionKeys.length === 1) {
        getLastTopicId =
          subscriptionsRef.current[subscriptionKeys[0]].getTopicId(); // Storing last topicId
      }
      subscriptionKeys.forEach((subId: string) => {
        if (subscriptionsRef.current[subId]) {
          if (client.connected) {
            subscriptionsRef.current[subId].unsubscribe();
          }
          delete subscriptionsRef.current[subId];
        }
      });
    }
    checkAndDisconnectClient(getLastTopicId || '');
  }, [client, checkAndDisconnectClient]);

  /**
   * Method to set client and subscribe all topics
   * @returns void
   */
  const setClientAndSubscribeAll = useCallback((): void => {
    if (subscriptionsRef.current) {
      Object.keys(subscriptionsRef.current).forEach((subId) => {
        if (subscriptionsRef.current[subId]) {
          if (client.connected) {
            subscriptionsRef.current[subId].setClientAndSubscribe(client);
          }
        }
      });
    }
  }, [subscriptionsRef, client]);

  /**
   * Method for client connect success callback
   * @returns void
   */
  const connectSuccessCallback = useCallback((): void => {
    if (isClientConnectionBroken.current) {
      // subscribeAll
      if (subscriptionsRef.current) {
        Object.keys(subscriptionsRef.current).forEach((subId) => {
          if (subscriptionsRef.current[subId]) {
            if (client.connected) {
              subscriptionsRef.current[subId].subscribe();
            }
          }
        });
      }
    } else {
      resolveAllPromises();
      setClientAndSubscribeAll();
    }
    isPollingActive.current = false;
    clientReconnectionTries.current = 0;
    client.reconnectDelay = reconnectDelay;
    isFirstConnection.current = false;
  }, [client, reconnectDelay, setClientAndSubscribeAll]);

  /**
   * Method for client connect error callback
   * @returns void
   */
  const connectErrorCallback = useCallback((): void => {
    // errorCallback
    resolveAllPromises();
    isFirstConnection.current = false;
  }, []);

  /**
   * Method for client connect close/disconnect callback
   * @returns void
   */
  const connectCloseCallback = useCallback((): void => {
    // closeCallback
    if (!isFirstConnection.current) {
      // case where client got disconnected after connecting once

      if (isClientDisconnectedForced.current) {
        // if we disconnected client on last subscription removed
        isClientDisconnectedForced.current = false;
        // do nothing
      } else {
        // if client never got connected or got broken
        isClientConnectionBroken.current = true;
        if (clientReconnectionTries.current < clientMaxReconnectionTries) {
          startAllPollings();
          clientReconnectionTries.current += 1;
        } else {
          client.reconnectDelay = 0;
          unsubscribeAll();
          onDisconnectHandler();
        }
      }
    } else {
      // case: initial client connection failure
      if (clientReconnectionTries.current < clientMaxReconnectionTries) {
        clientReconnectionTries.current += 1;
      } else {
        client.reconnectDelay = 0;
        resolveAllPromises();
        isFirstConnection.current = false;
      }
    }
  }, [
    client,
    clientMaxReconnectionTries,
    startAllPollings,
    onDisconnectHandler,
    unsubscribeAll,
  ]);

  /**
   * Method to create client and resolving Promise
   * @returns Promise<any>
   */
  const createClient = useCallback(
    async (topicId: string): Promise<any> => {
      if (!client.active) {
        client.connect(
          { 'x-ws-key': topicId }, // authentication
          connectSuccessCallback,
          connectErrorCallback,
          connectCloseCallback
        );
      }
    },
    [client, connectSuccessCallback, connectErrorCallback, connectCloseCallback]
  );

  /**
   * Method to hold promises and call generate token
   * @returns Promise<any>
   */
  const holdPromise = useCallback(
    async (topicId: string): Promise<any> => {
      return new Promise(async (resolve) => {
        promiseArr.push(resolve);
        createClient(topicId);
      });
    },
    [createClient]
  );

  /**
   * Method for topic subscriptions
   * @param {string} id
   * @returns void
   */
  const onUnsubscribe = (id: string): void => {
    if (subscriptionsRef.current && subscriptionsRef.current[id]) {
      delete subscriptionsRef.current[id];
    }
  };

  /**
   * Method for topicId subscriptions
   * @param {string} topicId
   * @param {ISubscribeOptions} options
   * @returns Promise<any>
   */
  const subscribe = useCallback(
    async (topicId: string, options: ISubscribeOptions): Promise<any> => {
      return new Promise(async (resolve) => {
        let subscription = null;
        subscription = new Subscription(
          client.connected ? client : null,
          topicId,
          options,
          onUnsubscribe
        );
        subscriptionsRef.current[subscription.getId()] = subscription;
        if (!client?.connected) {
          subscription.startPolling();
        }
        if (isFirstConnection.current) {
          await holdPromise(topicId);
        }
        resolve(subscription);
      });
    },
    [client, holdPromise]
  );

  /**
   * Method for registering callback for client disconnect
   * @param callback
   * @returns void
   */
  const onDisconnect = useCallback((callback: () => void): void => {
    disconnectCallback.current = callback;
  }, []);

  /**
   * Method for registering callback for client disconnect
   * @param callback
   * @returns void
   */
  const onBeforeDisconnect = useCallback(
    (callback: (topicId: string) => any): void => {
      beforeDisconnectCallback.current = callback;
    },
    []
  );

  /**
   * Method for unsubscribing individual topic
   * @param {string} id of subscription which you can get from subscription.getId() in consumer application
   * @returns void
   */
  const unsubscribe = useCallback(
    (id: string): void => {
      let topicId = null;
      if (subscriptionsRef.current[id]) {
        if (client.connected) {
          topicId = subscriptionsRef.current[id].getTopicId();
          subscriptionsRef.current[id].unsubscribe();
        }
        delete subscriptionsRef.current[id];
        checkAndDisconnectClient(topicId);
      }
    },
    [client, checkAndDisconnectClient]
  );

  /**
   * TODO: later for setting client URL (if it was no provided initially)
   */
  const setUrl = useCallback(() => {}, []);
  const removeLogs = useCallback((callback: () => void): void => {
    client.debug = callback;
  }, []);
  const webSocketContextValue = useMemo(
    () => ({
      subscribe,
      unsubscribe,
      unsubscribeAll,
      onBeforeDisconnect,
      onDisconnect,
      setUrl,
      removeLogs,
    }),
    [subscribe, unsubscribe, unsubscribeAll, onDisconnect, setUrl, removeLogs]
  );

  return (
    <WebSocketContext.Provider value={webSocketContextValue}>
      {children}
    </WebSocketContext.Provider>
  );
};

export default WebSocketProvider;

interface ISubscriptions {
  [key: string]: any; // need to implement ISubscription properly later (ISubscription[])
}

export interface WebSocketContextType {
  subscribe: (topicId: string, options: ISubscribeOptions) => any; // void return will be changed to return of ISubscriptionObject
  unsubscribe: (id: string) => void;
  unsubscribeAll: (id: string) => void;
  setUrl: (url: string) => void;
  onDisconnect: (callback: any) => void;
  onBeforeDisconnect: (callback: any) => void;
  removeLogs: (callback: any) => void;
}

interface IWebSocketProvider {
  children: ReactNode;
  url?: string;
  config?: {
    protocols?: string[];
    reconnectionDelay?: number;
    reconnectionTries?: number;
    sendMessageUrl?: string;
  };
  // options?: {
  //   getHeaders?: () => void; // void return will be changed to what headers could come as response
  //   isAuthenticated?: boolean;
  // };
}
