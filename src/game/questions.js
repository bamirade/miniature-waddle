const questions = [
  {
    id: 'q001',
    text: '7 + 5 equals 12.',
    options: ['True', 'False'],
    answerIndex: 0
  },
  {
    id: 'q002',
    text: '9 × 3 equals 27.',
    options: ['True', 'False'],
    answerIndex: 0
  },
  {
    id: 'q003',
    text: '15 - 6 equals 10.',
    options: ['True', 'False'],
    answerIndex: 1
  },
  {
    id: 'q004',
    text: '24 ÷ 6 equals 4.',
    options: ['True', 'False'],
    answerIndex: 0
  },
  {
    id: 'q005',
    text: 'The pattern 2, 4, 6 continues with 8.',
    options: ['True', 'False'],
    answerIndex: 0
  },
  {
    id: 'q006',
    text: 'Decimal 5 in binary is 101.',
    options: ['True', 'False'],
    answerIndex: 0
  },
  {
    id: 'q007',
    text: 'A keyboard is an input device.',
    options: ['True', 'False'],
    answerIndex: 0
  },
  {
    id: 'q008',
    text: 'RAM is the best place for long-term file storage.',
    options: ['True', 'False'],
    answerIndex: 1
  },
  {
    id: 'q009',
    text: 'HTML is mainly used to structure web pages.',
    options: ['True', 'False'],
    answerIndex: 0
  },
  {
    id: 'q010',
    text: 'CSS is mainly used to store database records.',
    options: ['True', 'False'],
    answerIndex: 1
  },
  {
    id: 'q011',
    text: 'JavaScript in a browser can change page content.',
    options: ['True', 'False'],
    answerIndex: 0
  },
  {
    id: 'q012',
    text: 'A for loop is useful when the repeat count is known.',
    options: ['True', 'False'],
    answerIndex: 0
  },
  {
    id: 'q013',
    text: 'If x = 10, then x > 7 is true.',
    options: ['True', 'False'],
    answerIndex: 0
  },
  {
    id: 'q014',
    text: 'In JavaScript, strict equality is written as ===.',
    options: ['True', 'False'],
    answerIndex: 0
  },
  {
    id: 'q015',
    text: 'A bit is smaller than a byte.',
    options: ['True', 'False'],
    answerIndex: 0
  },
  {
    id: 'q016',
    text: 'One byte contains 8 bits.',
    options: ['True', 'False'],
    answerIndex: 0
  },
  {
    id: 'q017',
    text: 'URL stands for Uniform Resource Locator.',
    options: ['True', 'False'],
    answerIndex: 0
  },
  {
    id: 'q018',
    text: 'The password "Mango!7River#2" is stronger than "password123".',
    options: ['True', 'False'],
    answerIndex: 0
  },
  {
    id: 'q019',
    text: 'All cats are mammals.',
    options: ['True', 'False'],
    answerIndex: 0
  },
  {
    id: 'q020',
    text: 'In many languages, else handles the opposite branch of if.',
    options: ['True', 'False'],
    answerIndex: 0
  },
  {
    id: 'q021',
    text: 'The first array index in JavaScript is 1.',
    options: ['True', 'False'],
    answerIndex: 1
  },
  {
    id: 'q022',
    text: 'console.log() prints to the browser console.',
    options: ['True', 'False'],
    answerIndex: 0
  },
  {
    id: 'q023',
    text: 'Ascending order means smallest to largest.',
    options: ['True', 'False'],
    answerIndex: 0
  },
  {
    id: 'q024',
    text: '3 squared equals 6.',
    options: ['True', 'False'],
    answerIndex: 1
  },
  {
    id: 'q025',
    text: '90 minutes equals 1 hour 30 minutes.',
    options: ['True', 'False'],
    answerIndex: 0
  },
  {
    id: 'q026',
    text: '100% of 45 is 45.',
    options: ['True', 'False'],
    answerIndex: 0
  },
  {
    id: 'q027',
    text: 'True OR False evaluates to True.',
    options: ['True', 'False'],
    answerIndex: 0
  },
  {
    id: 'q028',
    text: 'True AND False evaluates to True.',
    options: ['True', 'False'],
    answerIndex: 1
  },
  {
    id: 'q029',
    text: '7 is an odd number.',
    options: ['True', 'False'],
    answerIndex: 0
  },
  {
    id: 'q030',
    text: '11 is a prime number.',
    options: ['True', 'False'],
    answerIndex: 0
  }
];

const BINARY_LABEL_SETS = Object.freeze({
  true_false: Object.freeze(['True', 'False']),
  yes_no: Object.freeze(['Yes', 'No']),
  agree_disagree: Object.freeze(['Agree', 'Disagree']),
});

function normalizeLabelSetKey(labelSetKey) {
  const normalized = String(labelSetKey || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(BINARY_LABEL_SETS, normalized)
    ? normalized
    : 'true_false';
}

function getLabelSetOptions(labelSetKey) {
  const key = normalizeLabelSetKey(labelSetKey);
  return [...BINARY_LABEL_SETS[key]];
}

function projectQuestionToLabelSet(question, labelSetKey) {
  if (!question || typeof question !== 'object') {
    return question;
  }

  return {
    ...question,
    options: getLabelSetOptions(labelSetKey),
  };
}

function getRandomQuestion(excludeIdsSet = new Set()) {
  const excluded = excludeIdsSet instanceof Set
    ? excludeIdsSet
    : new Set(excludeIdsSet || []);

  const available = questions.filter((question) => !excluded.has(question.id));
  const pool = available.length > 0 ? available : questions;
  const randomIndex = Math.floor(Math.random() * pool.length);
  return pool[randomIndex];
}

module.exports = {
  BINARY_LABEL_SETS,
  questions,
  getRandomQuestion,
  normalizeLabelSetKey,
  getLabelSetOptions,
  projectQuestionToLabelSet,
};
