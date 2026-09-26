export const supportedSubjects = ['Coding', 'Creative AI', 'Robotics', 'Math Puzzles'] as const;
export type Subject = typeof supportedSubjects[number];
