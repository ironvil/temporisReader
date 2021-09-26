import {PageSize} from "./reading-screen-logic/book-handler/BookHandler";

const FONT_WIDTH_MULTIPLIER = 29 / 33;

function calculateCharsPerLine(width: number, fontSize: number): number {
  const fontWidth = fontSize * FONT_WIDTH_MULTIPLIER;
  return width / fontWidth;
}

function calculateNumberOfLines(
  height: number,
  fontSize: number,
  fontSpacingMultiplier: number,
): number {
  const lineHeight = fontSize * fontSpacingMultiplier;
  return height / lineHeight;
}

export function calculatePageSize(
  height: number,
  width: number,
  fontSize: number,
  fontSpacingMultiplier: number,
): PageSize {
  return {
    charsPerLine: calculateCharsPerLine(width, fontSize),
    numLines: calculateNumberOfLines(height, fontSize, fontSpacingMultiplier),
  };
}
