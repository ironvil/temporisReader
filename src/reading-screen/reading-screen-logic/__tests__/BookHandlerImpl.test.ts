import BookHandlerImpl from "../book-handler/BookHandlerImpl";
import FileParserImpl from "../file-parser/FileParserImpl";
import FileLoader from "../file-loader/FileLoader";
import {Location, PageSize} from "../book-handler/BookHandler";

describe("BookHandlerImpl test", () => {
  function calculateResult(
    fileString: string,
    location: Location = {paragraph: 0, placeInParagraph: 0},
    pageSize: PageSize = {charsPerLine: 20, numLines: 1},
  ): string[] | false {
    const fileLoader: FileLoader = {
      loadFile: (fileName, callBack) =>
        callBack(new FileParserImpl(fileString)),
    };

    const bookHandler = new BookHandlerImpl(fileLoader);

    bookHandler.loadFile("foobar");

    return bookHandler.getPage(location, pageSize);
  }

  function assertMatchesPage(
    result: string[] | false,
    expected: string[],
  ): void {
    if (result === false) fail("trying to compare false result");
    expect(JSON.stringify(result)).toBe(JSON.stringify(expected));
  }

  it("returns whole file when only one word", () => {
    const result = calculateResult("Singlewordfile");
    assertMatchesPage(result, ["Singlewordfile"]);
  });

  it("returns whole text when exact line length", () => {
    const result = calculateResult("multiple words fit o");
    assertMatchesPage(result, ["multiple", "words", "fit", "o"]);
  });

  it("omits last word when longer than line", () => {
    const result = calculateResult("multiple words fit on");
    assertMatchesPage(result, ["multiple", "words", "fit"]);
  });
});
