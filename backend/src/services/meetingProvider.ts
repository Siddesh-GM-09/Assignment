export type MeetingProviderId = 'INTERNAL_CLASSROOM';

export type MeetingRoom = {
  provider: MeetingProviderId;
  url: string;
};

export interface MeetingProvider {
  readonly id: MeetingProviderId;
  createRoom(classToken: string): MeetingRoom;
}

/** A secure, booking-specific waiting room. It does not claim to provide live audio/video. */
export class InternalClassroomProvider implements MeetingProvider {
  readonly id = 'INTERNAL_CLASSROOM' as const;
  private readonly baseUrl: string;

  constructor(publicAppUrl: string) {
    let url: URL;
    try {
      url = new URL(publicAppUrl);
    } catch {
      throw new Error('PUBLIC_APP_URL must be a valid HTTPS URL (HTTP is allowed for localhost development).');
    }
    const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((!localHttp && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash) {
      throw new Error('PUBLIC_APP_URL must use HTTPS, except for localhost development, and must not contain credentials, a query, or a fragment.');
    }
    this.baseUrl = `${url.origin}${url.pathname.replace(/\/$/, '')}`;
  }

  createRoom(classToken: string): MeetingRoom {
    return {
      provider: this.id,
      url: `${this.baseUrl}/class/${encodeURIComponent(classToken)}`,
    };
  }
}
