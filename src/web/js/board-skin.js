/**
 * The paper board's ink-coloured pieces (v8-0-plan A3).
 *
 * The paper board's palette names the ink and paper its men are printed in
 * (--piece-ink: "<ink> <paper>"); this turns that into pixels. 17.0 T: what
 * else lived here — the procedural textures (wood, a fine grain, paper's
 * fibre, marble's veins) laid over the squares — is gone: every board is two
 * flat colours, as the user asked.
 * @module board-skin
 */

/**
 * Parse --piece-ink ("#ink #paper"), or null when the board prints its men
 * as drawn.
 * @returns {{ink: string, paper: string}|null}
 */
export function parseInk(v) {
  const m = /^\s*(#[0-9a-f]{6})\s+(#[0-9a-f]{6})\s*$/i.exec(v || "");
  return m ? { ink: m[1], paper: m[2] } : null;
}

/**
 * Reprint a piece sprite in ink on paper, in place: its black becomes the
 * ink, its white the paper, every grey in between the matching mix, and the
 * shape (alpha) is kept. `screen` with the ink lifts black to ink and leaves
 * white alone; `multiply` with the paper takes white down to paper and
 * leaves ink nearly as it is; `destination-in` with the original puts the
 * transparency back.
 * @param {HTMLCanvasElement} c  a sprite already drawn at its size
 * @param {HTMLImageElement} img the piece it was drawn from
 * @param {{ink: string, paper: string}} ink
 */
export function inkSprite(c, img, ink) {
  const pen = c.getContext("2d");
  const w = c.width, h = c.height;
  pen.save();
  pen.globalCompositeOperation = "screen";
  pen.fillStyle = ink.ink;
  pen.fillRect(0, 0, w, h);
  pen.globalCompositeOperation = "multiply";
  pen.fillStyle = ink.paper;
  pen.fillRect(0, 0, w, h);
  pen.globalCompositeOperation = "destination-in";
  pen.drawImage(img, 0, 0, w, h);
  pen.restore();
}

export const ChessBoardSkin = { parseInk, inkSprite };
