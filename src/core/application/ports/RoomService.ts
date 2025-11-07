export interface RoomService {
  normalize(
    hall: string,
    roomRaw: string,
  ): Promise<{
    valid: boolean;
    room?: string;
    errors?: string[];
  }>;
}
