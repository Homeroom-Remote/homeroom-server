const config = require("config");
function calculateScore(
  machineLearningLogs,
  engagementLogs,
  durationInSeconds
) {
  function getRandomTip(arrayOfTips) {
    return arrayOfTips[Math.floor(Math.random() * arrayOfTips.length)];
  }

  const scoring_system = config.app.scoring_system;
  const durationInMinutes = durationInSeconds / 60;
  const goodTipThreshold = scoring_system.good_tip_threshold;

  if (durationInMinutes < config.app.meeting_score_threshold_in_minutes)
    return null;

  var tips = [];
  var score = 0;

  /////////////
  // Engagement
  /////////////
  const questionPercentage = scoring_system.questions;
  const chatPercentage = scoring_system.chat;

  const questionRequirements = scoring_system.question_requirements;
  const chatRequirements = scoring_system.chat_requirements;

  const averageQuestionsPerMinute =
    engagementLogs.filter((log) => log.event === "question").length /
    durationInMinutes;

  const averageChatMessagesPerMinute =
    engagementLogs.filter((log) => log.event === "chat").length /
    durationInMinutes;

  const questionsMark =
    (averageQuestionsPerMinute /
      (questionRequirements[0] / questionRequirements[1])) *
    100;
  const chatMark =
    (averageChatMessagesPerMinute /
      (chatRequirements[0] / chatRequirements[1])) *
    100;

  score += Math.min(100, questionsMark) * questionPercentage;
  score += Math.min(100, chatMark) * chatPercentage;

  tips.push(
    getRandomTip(
      questionsMark >= goodTipThreshold
        ? scoring_system.tips.questions_good
        : scoring_system.tips.questions_bad
    )
  );

  ////////////////
  // Concentration
  ////////////////
  const concentrationPercentage = scoring_system.concentration;
  const concentrationRequirements = scoring_system.concentration_requirements;
  const concentrationMark =
    machineLearningLogs.reduce(
      (prev, current) => prev + (current?.concentration?.score || prev),
      0
    ) / machineLearningLogs.length;

  score += Math.min(100, concentrationMark * 100) * concentrationPercentage;

  tips.push(
    getRandomTip(
      concentrationMark >= concentrationRequirements
        ? scoring_system.tips.concentration_good
        : scoring_system.tips.concentration_bad
    )
  );
  //////////////
  // Expressions
  //////////////
  const expressionsPercentage = scoring_system.expressions;
  const expressionsRequirements = scoring_system.expressions_requirements;
  const expressionsScores = scoring_system.expressions_scoring;
  const scoreSwitch = {
    neutral: expressionsScores.neutral,
    happy: expressionsScores.happy,
    sad: expressionsScores.sad,
    disgusted: expressionsScores.disgusted,
    fearful: expressionsScores.fearful,
  };

  var expressionsAcc = 0;
  var surprised = 0;
  var relevantLogs = 0;

  machineLearningLogs.forEach((log) => {
    const expressions = log?.expressions?.expressions;
    if (expressions) {
      relevantLogs += 1;
      surprised += expressions.surprised;
      expressionsAcc += expressions.neutral * scoreSwitch["neutral"];
      expressionsAcc += expressions.happy * scoreSwitch["happy"];
      expressionsAcc += expressions.sad * scoreSwitch["sad"];
      expressionsAcc += expressions.disgusted * scoreSwitch["disgusted"];
      expressionsAcc += expressions.fearful * scoreSwitch["fearful"];
    }
  });

  expressionsAcc +=
    surprised *
    (expressionsAcc < 0
      ? expressionsScores.surprised_if_positive
      : expressionsScores.surprised_if_negative);

  expressionsAcc = expressionsAcc.toFixed(2) / relevantLogs;
  score += Math.max(
    0,
    Math.min((expressionsAcc + 1) * 100, 100) * expressionsPercentage
  );

  tips.push(
    getRandomTip(
      expressionsAcc >= expressionsRequirements
        ? scoring_system.tips.expressions_good
        : scoring_system.tips.expressions_bad
    )
  );

  score = score.toFixed(2);

  return { score, tips };
}

var machineLearningLogs = [
  {
    concentration: { mSamples: 3, participants: 1, score: 0.826 },
    expressions: {
      expressions: {
        angry: 0,
        disgusted: 0,
        fearful: 0,
        happy: 0.49,
        neutral: 0.42,
        sad: 0.07,
        surprised: 0,
      },
      mSamples: 3,
      participants: 1,
    },
  },
  {
    concentration: { mSamples: 1, participants: 1, score: 0.937 },
    expressions: {
      expressions: {
        angry: 0,
        disgusted: 0.649,
        fearful: 0,
        happy: 0,
        neutral: 0.42,
        sad: 0.217,
        surprised: 0,
      },
      mSamples: 1,
      participants: 1,
    },
  },
  {
    concentration: { mSamples: 4, participants: 1, score: 0.864 },
    expressions: {
      expressions: {
        angry: 0,
        disgusted: 0.2692,
        fearful: 0,
        happy: 0,
        neutral: 0.4,
        sad: 0.19,
        surprised: 0,
      },
      mSamples: 4,
      participants: 1,
    },
  },
];

const engagementLogs = [{ event: "question" }, { event: "question" }];

const durationInSeconds = 60;

console.log(
  calculateScore(machineLearningLogs, engagementLogs, durationInSeconds)
);
