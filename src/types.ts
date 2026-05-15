export interface Lesson {
  id: string;
  title: string;
  content: string;
  fileUrl?: string; // Attachment for the specific lesson
  aiKnowledge?: string; // Extracted data from AI (not visible to student)
}

export interface QuizQuestion {
  question: string;
  options: string[];
  correctAnswer: number;
}

export interface TestConfig {
  type: 'ai' | 'manual' | 'none';
  questions: QuizQuestion[];
}

export interface Course {
  id: string;
  title: string;
  description: string;
  category: string;
  thumbnail: string;
  lessons: Lesson[];
  testConfig: TestConfig;
  isPublic?: boolean; // Access for all
  fileUrl?: string; // For uploaded PDF/MP4
  type?: 'presentation' | 'video' | 'scorm';
  hiddenFromUsers?: boolean; // Global hide
  assignedToUsers?: string[]; // IDs of users who can see this course if limited
}

export interface SimulatorSession {
  id?: string;
  userId: string;
  courseId: string;
  lessonId?: string;
  score: number;
  feedback: string;
  timestamp: string;
  createdAt?: any; // Normalized field
  chatHistory: { role: 'user' | 'model', parts: { text: string }[] }[];
}

export interface LessonProgress {
  lessonId: string;
  completed: boolean;
  score?: number;
}

export interface UserCourseProgress {
  courseId: string;
  userId: string;
  status: 'not-started' | 'in-progress' | 'completed';
  lessons: LessonProgress[];
  overallProgress: number; // 0-100
  lastUpdated: string;
}

export interface CourseResult {
  userId: string;
  courseId: string;
  score: number;
  progress: number;
  timestamp: string;
  createdAt?: any;
  tutorRating?: number;
}

export interface GlossaryTerm {
  id?: string;
  term: string;
  definition: string;
  category: string;
}

export interface UserProfile {
  id: string;
  name: string;
  position: string;
  role: 'admin' | 'manager' | 'employee';
  score: number; // Total platform score
  avatar?: string;
  department?: string;
  email?: string;
  bitrixId?: string;
  assignedCourses?: string[]; // IDs of assigned courses
  points?: number; // Coins / Rewards
  simulatorAttempts?: Record<string, number>; // lessonId -> count of successful trainings
}
