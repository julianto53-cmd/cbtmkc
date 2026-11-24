export type UserRole = 'admin' | 'guru' | 'pengawas' | 'siswa';

export type QuestionType = 'PG' | 'PGK' | 'BS' | 'JODOH' | 'ISIAN' | 'ESAI';

export interface AuthUser {
  id: number;
  username: string;
  fullName: string;
  role: UserRole;
  className: string;
}

export interface LoginSlide {
  id: number;
  title: string;
  subtitle: string;
  badge_label: string;
  image_url: string;
  sort_order: number;
  is_active?: number;
}

export interface QuestionBank {
  id: number;
  owner_id: number;
  owner_name?: string;
  owner_username?: string;
  title: string;
  subject: string;
  grade_level: string;
  description: string;
  question_count: number;
  created_at: string;
  updated_at: string;
}

export interface QuestionItem {
  id: number;
  bank_id: number;
  q_type: QuestionType;
  prompt_text: string;
  image_url: string;
  options_json: string;
  answer_key_json: string;
  max_score: number;
  difficulty_tag: string;
  explanation: string;
  sort_order: number;
}

export interface ParsedWordQuestion {
  tempId: string;
  qType: QuestionType;
  promptText: string;
  imageUrl: string;
  options: any;
  answerKey: any;
  maxScore: number;
  difficultyTag: string;
  explanation: string;
  warnings: string[];
}

export interface ExamItem {
  id: number;
  bank_id: number;
  owner_id: number;
  owner_name?: string;
  bank_title?: string;
  subject?: string;
  title: string;
  token_code: string;
  duration_minutes: number;
  max_violations: number;
  shuffle_questions: number;
  shuffle_options: number;
  show_result_to_student: number;
  status: 'DRAFT' | 'ACTIVE' | 'CLOSED';
  target_classes: string;
  start_at?: string;
  end_at?: string;
  session_count?: number;
  submitted_count?: number;
  locked_count?: number;
}

export interface StudentExamCard {
  id: number;
  title: string;
  subject: string;
  duration_minutes: number;
  max_violations: number;
  show_result_to_student: number;
  status: string;
  target_classes?: string;
  requires_token?: boolean;
  start_at?: string;
  end_at?: string;
  schedule_state?: 'UPCOMING' | 'OPEN' | 'EXPIRED';
  question_count: number;
  session_id: number | null;
  session_status: 'IN_PROGRESS' | 'LOCKED' | 'SUBMITTED' | null;
  violation_count: number | null;
  final_score: number | null;
  submitted_at: string | null;
}
