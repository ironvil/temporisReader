import {useCallback, useMemo, useState} from "react";

export function useGetTextOfCorrectLength(
  getText: (numOfChar: number) => string,
  startLength: number,
): {
  textIsCorrectlySized: boolean;
  text: string;
  onHeightChanged: (height: number) => void;
  onMaxHeightChanged: (height: number) => void;
} {
  const [isComplete, setIsComplete] = useState(false);
  const [currentLength, setCurrentLength] = useState(startLength);
  const [lowerBound, setLowerBound] = useState(0);
  const [upperBound, setUpperBound] = useState(startLength);
  const [originalGetText, setOriginalGetText] = useStateFunction(getText);
  const [currentMaxHeight, setCurrentMaxHeight] = useState(-1);
  const [currentHeight, setCurrentHeight] = useState(-1);
  const [isDirty, setIsDirty] = useState(false);

  const resetState = useCallback(() => {
    setIsComplete(false);
    setCurrentLength(startLength);
    setLowerBound(0);
    setUpperBound(startLength);
    setOriginalGetText(getText);
  }, [startLength, getText, setOriginalGetText]);

  if (originalGetText !== getText) {
    resetState();
  }

  let newLength = currentLength;
  let isNowComplete = isComplete;

  if (isDirty) {
    if (currentHeight !== -1 && currentMaxHeight !== -1) {
      setIsDirty(false);
      if (!isComplete) {
        const {newLowerBound, newUpperBound, newCurrentLength} =
          calculateNextIteration({
            currentHeight,
            currentMaxHeight,
            currentLength,
            lowerBound,
            upperBound,
          });
        setLowerBound(newLowerBound);
        setCurrentLength(newCurrentLength);
        setUpperBound(newUpperBound);
        if (newLowerBound === newUpperBound) {
          setIsComplete(true);
          isNowComplete = true;
        }
        newLength = newCurrentLength;
      }
    }
  }

  const onMaxHeightChanged = useCallback(
    newHeight => {
      setCurrentMaxHeight(newHeight);
      setIsDirty(true);
      if (isNowComplete) {
        resetState();
      }
    },
    [isNowComplete, resetState],
  );

  const onHeightChanged = useCallback(newHeight => {
    setCurrentHeight(newHeight);
    setIsDirty(true);
  }, []);

  return useMemo(() => {
    return {
      textIsCorrectlySized: isComplete,
      text: getText(newLength),
      onHeightChanged,
      onMaxHeightChanged,
    };
  }, [getText, isComplete, newLength, onHeightChanged, onMaxHeightChanged]);
}

function integerDivision(a: number, b: number): number {
  return Math.floor(a / b);
}

function integerMultiplication(a: number, b: number): number {
  return Math.floor(a * b);
}

function useStateFunction<Type>(
  initialState: Type,
): [Type, (newValue: Type) => void] {
  const [currentFunction, setCurrentFunction] = useState(() => initialState);

  const setFunction = useCallback(
    newFunction => setCurrentFunction(() => newFunction),
    [],
  );

  return [currentFunction, setFunction];
}

function calculateNextIteration({
  currentHeight,
  currentMaxHeight,
  currentLength,
  lowerBound,
  upperBound,
}: {
  currentHeight: number;
  currentMaxHeight: number;
  currentLength: number;
  lowerBound: number;
  upperBound: number;
}): {newLowerBound: number; newUpperBound: number; newCurrentLength: number} {
  let newLowerBound = lowerBound;
  let newUpperBound = upperBound;

  if (currentHeight <= currentMaxHeight) {
    if (currentLength === upperBound) {
      newUpperBound = integerMultiplication(upperBound, 2);
      return {
        newLowerBound,
        newCurrentLength: newUpperBound,
        newUpperBound,
      };
    }
    newLowerBound = currentLength;
  } else if (currentHeight > currentMaxHeight) {
    if (currentLength === lowerBound) {
      newLowerBound = integerDivision(lowerBound, 2);
      return {
        newLowerBound,
        newCurrentLength: newLowerBound,
        newUpperBound,
      };
    }
    if (upperBound === currentLength && lowerBound + 1 === currentLength) {
      newUpperBound = lowerBound;
    } else {
      newUpperBound = currentLength;
    }
  }

  if (currentLength === 0 && lowerBound === 0 && upperBound === 0) {
    newUpperBound = 5;
  }
  let newCurrentLength = integerDivision(newLowerBound + newUpperBound, 2);
  if (newCurrentLength === currentLength && currentLength < upperBound) {
    newCurrentLength = newCurrentLength + 1;
  } else if (newCurrentLength === currentLength && currentLength > lowerBound) {
    newCurrentLength = newCurrentLength - 1;
  }

  return {
    newLowerBound,
    newCurrentLength,
    newUpperBound,
  };
}
