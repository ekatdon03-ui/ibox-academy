export interface Lesson {
  id: string;
  title: string;
  content: string;
  fileUrl?: string;
  aiKnowledge?: string;
  testConfig?: TestConfig; // Optional per-lesson test shown after the lesson
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
  isPublic?: boolean;
  fileUrl?: string;
  type?: 'presentation' | 'video' | 'scorm';
  hiddenFromUsers?: boolean;
  assignedToUsers?: string[];
  assignedToDepartments?: string[]; // All users from these depts auto-get access
  hasSimulator?: boolean; // Whether AI simulator is available for this course (default: true)
  testMode?: 'none' | 'final' | 'per_lesson' | 'both'; // When quizzes appear (default: 'final')
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
  avatar?: string;
  department?: string;
  email?: string;
  bitrixId?: string;
  assignedCourses?: string[]; // IDs of assigned courses
}
