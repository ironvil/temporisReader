import BookHandlerImpl from "../book-handler/BookHandlerImpl";
import FileParserImpl from "../file-parser/FileParserImpl";
import FileLoader from "../fileLoader/FileLoader";

describe("BookHandlerImpl test", () => {
  it("returns whole file when only one word", () => {
    const fileLoader: FileLoader = {
      loadFile: (fileName, callBack) =>
        callBack(new FileParserImpl("Singlewordfile")),
    };

    const bookHandler = new BookHandlerImpl(fileLoader);

    bookHandler.loadFile("foobar");

    const result = bookHandler.getPage(
      {paragraph: 0, placeInParagraph: 0},
      {charsPerLine: 20, numLines: 1},
    );

    expect(JSON.stringify(result)).toBe('["Singlewordfile"]');
  });
});
