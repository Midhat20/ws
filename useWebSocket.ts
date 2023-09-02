import { useContext } from 'react';
import { WebSocketContext } from '@providers/WebSocketProvider';

export const useWebSocket = () => {
  return useContext(WebSocketContext);
};
