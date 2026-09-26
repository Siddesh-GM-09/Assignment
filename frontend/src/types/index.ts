export type Subject = 'Coding' | 'Creative AI' | 'Robotics' | 'Math Puzzles';

export type Slot = {
  time: string;
  label: string;
  availableMentors: number;
  lightestMentorLoad: number;
};

export type Recommendation = {
  date: string | null;
  time: string;
  label: string;
  startUtc: string;
  endUtc: string;
  parentTimezone: string;
  parentLocalTime: string;
  mentorTimezone: string | null;
  mentorLocalTime: string | null;
  availableMentors: number;
  reason: string;
};

export type Booking = {
  id: string;
  status: string;
  subject: Subject;
  parent: { name: string; email: string; timezone: string };
  mentor: { id: string; name: string; timezone: string };
  startUtc: string;
  endUtc: string;
  parentTime: string;
  mentorTime: string;
  classLink: string;
  meetingProvider: 'INTERNAL_CLASSROOM' | string;
  managementToken?: string | null;
  cancelledAt?: string | null;
  notifications?: { recipientType: string; email: string; status: string; type?: string }[];
};

export type Classroom = {
  id: string;
  status: string;
  subject: Subject;
  parentName: string;
  mentor: { name: string; timezone: string };
  startUtc: string;
  endUtc: string;
  parentTimezone: string;
  mentorTimezone: string;
  parentTime: string;
  mentorTime: string;
  meetingProvider: 'INTERNAL_CLASSROOM' | string;
  classroomUrl: string;
  cancelledAt: string | null;
  classStarted: boolean;
  classEnded: boolean;
  joinAvailable: boolean;
};

export type ApiErrorBody = { code?: string; message?: string; alternatives?: Slot[] };
