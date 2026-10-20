import { type Status } from './status-menu';

/** An idea as the table and the board show it (serializable for client components). */
export interface IdeaItem {
  id: string;
  title: string;
  source: string;
  via: string;
  keyword: string | null;
  status: Status;
  assigneeName: string | null;
  createdByName: string;
  updatedAt: string;
  thumbSrc: string | null;
  imageSrc: string | null;
}
