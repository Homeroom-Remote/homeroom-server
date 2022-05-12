function disposeQuestionIfExists(questionId, questionQueue) {
  const questionIdx = questionQueue.findIndex((data) => data.id === questionId);
  if (questionIdx === -1)
    // Doesn't exist
    return questionQueue;

  return questionQueue.filter((data) => data.id !== questionId);
}

function isQuestionInQueue(questionId, questionQueue) {
  return questionQueue.findIndex((data) => data.id === questionId) !== -1;
}

module.exports = {
  disposeQuestionIfExists,
  isQuestionInQueue,
};
