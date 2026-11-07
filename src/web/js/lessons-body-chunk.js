/**
 * The entry of chunk-lessons-body.js (scripts/bundle.mjs CHUNKS): the
 * paragraphs and tasks of the course's first two parts, which the first
 * paint leaves out (14.0 E, trainer/lessons-body.js).
 * @module lessons-body-chunk
 */
import { CHESS_LESSONS } from "./lessons.js";
import { lessonBodies } from "./trainer/lessons-body.js";

export const CHESS_LESSONS_BODY = lessonBodies(CHESS_LESSONS);
