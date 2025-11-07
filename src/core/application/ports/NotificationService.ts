export interface NotificationService {
  sendDM(
    userId: string,
    template: string,
    data?: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<void>;
  sendToQueue(
    channelId: string,
    template: string,
    data?: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<void>;
}
