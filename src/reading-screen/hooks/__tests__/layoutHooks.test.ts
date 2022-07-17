import {act, renderHook, RenderResult} from "@testing-library/react-hooks";
import {useGetTextOfCorrectLength} from "../useGetTextOfCorrectLength";

describe("layout hooks test", () => {
  it("takes less than length iterations", () => {
    const {result} = renderUseGetTextOfCorrectLength(400, 500);

    expect(result.current.textIsCorrectlySized).toBe(true);
  });

  it("returns same length if start length already correct", () => {
    const {result} = renderUseGetTextOfCorrectLength(400, 400);

    expect(result.current.textIsCorrectlySized).toBe(true);
    expect(result.current.text.length).toBe(400);
  });

  it("calculates correct length if start length longer than desired length", () => {
    const {result} = renderUseGetTextOfCorrectLength(400, 500);

    expect(result.current.textIsCorrectlySized).toBe(true);
    expect(result.current.text.length).toBe(400);
  });

  it("calculates correct length if start length double desired length", () => {
    const {result} = renderUseGetTextOfCorrectLength(400, 800);

    expect(result.current.textIsCorrectlySized).toBe(true);
    expect(result.current.text.length).toBe(400);
  });

  it("calculates correct length if start length shorter than desired length", () => {
    const {result} = renderUseGetTextOfCorrectLength(400, 150);

    expect(result.current.textIsCorrectlySized).toBe(true);
    expect(result.current.text.length).toBe(400);
  });

  it("calculates correct length if start length is half desired length", () => {
    const {result} = renderUseGetTextOfCorrectLength(400, 200);

    expect(result.current.textIsCorrectlySized).toBe(true);
    expect(result.current.text.length).toBe(400);
  });

  it("calculates correct length if start length is one less than desired length", () => {
    const {result} = renderUseGetTextOfCorrectLength(400, 399);

    expect(result.current.textIsCorrectlySized).toBe(true);
    expect(result.current.text.length).toBe(400);
  });

  it("calculates correct length if start length is one more than desired length", () => {
    const {result} = renderUseGetTextOfCorrectLength(400, 401);

    expect(result.current.textIsCorrectlySized).toBe(true);
    expect(result.current.text.length).toBe(400);
  });

  it("calculates correct length if start length is zero", () => {
    const {result} = renderUseGetTextOfCorrectLength(400, 0);

    expect(result.current.textIsCorrectlySized).toBe(true);
    expect(result.current.text.length).toBe(400);
  });

  it("recalculates when background height changes when complete", () => {
    const {result} = renderUseGetTextOfCorrectLength(400, 400);

    expect(result.current.textIsCorrectlySized).toBe(true);
    expect(result.current.text.length).toBe(400);

    setMaxHeightThenFireLoopsTillMaxDesiredLength(result, 200, 3);

    expect(result.current.textIsCorrectlySized).toBe(true);
    expect(result.current.text.length).toBe(200);
  });

  // it("recalculates when height changed when complete", () => {
  //   const {result} = renderUseGetTextOfCorrectLength(400, 400);
  //
  //   expect(result.current.textIsCorrectlySized).toBe(true);
  //   expect(result.current.text.length).toBe(400);
  //
  //   act(() => {
  //     result.current.onHeightChanged(3);
  //   });
  //
  //   fireLoopsTillMaxDesiredLength(result, 200, 2);
  //
  //   expect(result.current.textIsCorrectlySized).toBe(true);
  //   expect(result.current.text.length).toBe(200);
  // });
  //
  // it("recalculates when height changed new height fits but less than desired", () => {
  //   const {result} = renderUseGetTextOfCorrectLength(400, 400);
  //
  //   expect(result.current.textIsCorrectlySized).toBe(true);
  //   expect(result.current.text.length).toBe(400);
  //
  //   act(() => {
  //     result.current.onHeightChanged(2);
  //   });
  //
  //   fireLoopsTillMaxDesiredLength(result, 380, 2);
  //
  //   expect(result.current.textIsCorrectlySized).toBe(true);
  //   expect(result.current.text.length).toBe(380);
  // });

  it("handles height change whilst still calculating bigger", () => {
    const {result} = renderHookOnly(600);
    act(() => {
      result.current.onMaxHeightChanged(4);
    });

    let count = 0;
    while (count < 3) {
      act(() => {
        const height = result.current.text.length <= 400 ? 4 : 5;
        result.current.onHeightChanged(height);
      });
      count++;
    }

    fireLoopsTillMaxDesiredLength(result, 800, 4);
  });

  it("handles height change whilst still calculating smaller", () => {
    const {result} = renderHookOnly(600);
    act(() => {
      result.current.onMaxHeightChanged(4);
    });

    let count = 0;
    while (count < 3) {
      act(() => {
        const height = result.current.text.length <= 400 ? 4 : 5;
        result.current.onHeightChanged(height);
      });
      count++;
    }

    fireLoopsTillMaxDesiredLength(result, 50, 4);
  });

  it("fires handle text before background", () => {
    const {result} = renderHookOnly(600);

    expect(result.all.length).toBe(1);
    act(() => {
      const height = result.current.text.length <= 400 ? 4 : 5;
      result.current.onHeightChanged(height);
    });

    expect(result.current.text.length).toBe(600);
    expect(result.all.length).toBe(2);
    act(() => {
      result.current.onMaxHeightChanged(4);
    });

    expect(result.current.text.length).toBe(300);
    expect(result.all.length).toBe(3);
  });
});

const text =
  "\n" +
  "\n" +
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed rutrum tristique congue. Vestibulum auctor eu velit sed molestie. Pellentesque ac leo ut risus volutpat consequat et vitae elit. Fusce a nunc ultrices, aliquet ipsum eu, egestas est. Duis venenatis nisl ex, vel placerat diam dapibus vitae. Nunc porttitor placerat nibh, interdum imperdiet quam facilisis at. Phasellus vitae metus a augue rutrum posuere. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Morbi mattis imperdiet ligula tristique blandit. Sed libero nisi, cursus sed aliquam sit amet, tempor vel nulla. Nulla facilisi. Pellentesque blandit, ipsum sed tincidunt semper, arcu magna placerat diam, at lobortis purus risus vel risus. Quisque pellentesque quis sapien vestibulum feugiat. Sed id aliquam diam. Donec eu velit condimentum mi placerat tincidunt.\n" +
  "\n" +
  "Sed placerat sagittis metus, at ullamcorper eros tincidunt nec. Curabitur imperdiet erat sed libero efficitur laoreet. Curabitur venenatis arcu diam, quis gravida diam rutrum nec. Cras scelerisque commodo lacinia. Sed molestie tincidunt dignissim. Vivamus auctor mi sed felis condimentum condimentum. Vestibulum nisi nisi, pharetra a libero vel, molestie volutpat arcu. Nullam pellentesque sapien at eros rutrum tempus quis non enim. Sed malesuada sagittis eros quis scelerisque. Nullam a eros vitae velit finibus varius.\n" +
  "\n" +
  "Donec sed nunc in massa scelerisque malesuada. Cras sed turpis nec est luctus fringilla. Sed sodales sollicitudin aliquam. Mauris in tortor ut quam rutrum rutrum ut vel est. Maecenas aliquet tempus risus, eget imperdiet enim tristique ac. Curabitur ac magna eu dui faucibus iaculis sed ut nisi. Integer augue lacus, varius quis mauris sit amet, consectetur tempor nibh. Curabitur eget tempus purus. Morbi vitae velit in lacus mattis maximus a a elit. Vestibulum luctus gravida elit, nec tempor odio varius id. Nullam vulputate, urna non consectetur gravida, nisi orci faucibus sem, eu consequat ex neque eget tortor. Pellentesque et enim et lectus lacinia vulputate. Ut in lectus turpis.\n" +
  "\n" +
  "Nulla tempus venenatis velit, in suscipit ipsum egestas eget. Nulla hendrerit tortor ac leo tincidunt bibendum. Nam efficitur lorem quam, quis tempus nisl porta eu. Nulla tellus lacus, convallis eu dapibus sed, tempor in nunc. Duis erat nunc, tincidunt at interdum sed, porttitor ac augue. Curabitur ut mollis nunc. Integer imperdiet lorem id nunc egestas, ut dapibus augue volutpat. Sed eget tempus ante, quis sagittis felis. Orci varius natoque penatibus et magnis dis parturient montes, nascetur ridiculus mus.\n" +
  "\n" +
  "Aliquam fringilla quis nulla ac lacinia. Sed tempus, libero ut laoreet bibendum, lectus risus gravida enim, vitae maximus risus odio vel neque. Aenean rutrum sed enim et luctus. In sit amet nisl massa. Pellentesque feugiat tempus sagittis. Curabitur ut sollicitudin diam. Morbi feugiat consequat enim. Fusce rutrum odio sit amet sapien consequat placerat. Mauris tristique dictum lectus non consequat. Morbi eget pellentesque tortor. ";

function getText(numOfChars: number) {
  return text.substring(0, numOfChars);
}

function fireLoopsTillMaxDesiredLength(
  result: RenderResult<{
    textIsCorrectlySized: boolean;
    text: string;
    onHeightChanged: (height: number) => void;
    onMaxHeightChanged: (height: number) => void;
  }>,
  desiredLength: number,
  maxHeight: number,
) {
  let count = 0;
  let length = -1;
  let currentLength = result.current.text.length;
  while (
    !result.current.textIsCorrectlySized &&
    count < desiredLength &&
    length !== currentLength
  ) {
    act(() => {
      const height = currentLength <= desiredLength ? maxHeight : maxHeight + 1;
      result.current.onHeightChanged(height);
    });
    length = currentLength;
    currentLength = result.current.text.length;

    count++;
  }

  if (result.current.textIsCorrectlySized) {
    act(() => {
      result.current.onHeightChanged(maxHeight);
    });
  }
}

function setMaxHeightThenFireLoopsTillMaxDesiredLength(
  result: RenderResult<{
    textIsCorrectlySized: boolean;
    text: string;
    onHeightChanged: (height: number) => void;
    onMaxHeightChanged: (height: number) => void;
  }>,
  desiredLength: number,
  maxHeight: number,
) {
  const timesRendered = result.all.length;
  const currentLength = result.current.text.length;
  act(() => {
    result.current.onMaxHeightChanged(maxHeight);
    const height = currentLength <= desiredLength ? maxHeight : maxHeight + 1;
    result.current.onHeightChanged(height);
  });
  expect(timesRendered).not.toBe(result.all.length);
  expect(currentLength).not.toBe(result.current.text.length);

  fireLoopsTillMaxDesiredLength(result, desiredLength, maxHeight);
}

function renderHookOnly(startLength: number) {
  return renderHook(() => useGetTextOfCorrectLength(getText, startLength));
}

function renderUseGetTextOfCorrectLength(
  desiredLength: number,
  startLength: number,
) {
  const renderResult = renderHookOnly(startLength);

  const {result} = renderResult;
  setMaxHeightThenFireLoopsTillMaxDesiredLength(result, desiredLength, 2);
  return renderResult;
}
