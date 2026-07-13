# Stock Price Reaction to News and No-News:

# Drift and Reversal After Headlines

Wesley S. Chan
M.I.T.

First Draft: 8/28/2000
This Draft: 5/11/2001

## Abstract

I examine returns to a subset of stocks after public news about them is released.
I compare them to other stocks with similar monthly returns, but no identiable public
news. There is a major dierence between return patterns for the two sets. I nd evidence
of post-news drift, which supports the idea that investors underreact to information.
This is strongest after bad news. I also nd some evidence of reversal after extreme
price movements that are unaccompanied by public news. The patterns are seen even
after excluding earnings announcements, controlling for potential risk exposure, and other
adjustments. They appear, however, to apply mainly to smaller stocks. I also nd evidence
that trading frictions, such as short-sale constraints, may play a role in the post-bad-news
drift pattern.

I wish to thank Kent Daniel, Ken French, Li Jin, S. P. Kothari, Jon Lewellen, Andrew Lo, Sendhil Mullainathan, Dimitri Vayanos, and Georey Verter for many stimulating discussions, and the members of the MIT
PhD Finance seminar for their helpful comments. Please address all correspondence to me at wschan@mit.edu.

---

## 1 Introduction

There is a large amount of evidence that stock prices are predictable. In the last decade, various
studies have shown that stock returns exhibit reversal at weekly and 3-5 year intervals, and drift
1
over 12-month periods. Some research shows that stock prices appear to drift after important
2
corporate events for up to several months. This suggests that some of the drift is driven by
underreaction to information. However, there are also numerous days when nancial markets
move dramatically, but without any apparent economic news or stimulus. In other words, there
3
appears to be \excess volatility" in asset prices. This suggests that investors may react (or
overreact) to unobserved stimuli. These two phenomena raise an interesting question. Is there
a predictable dierence between stock returns after public news announcements and returns
after large price movements, but no public news?

Using a database of news stories about companies from major news sources, I look at
stock returns after two sources of information. The rst is major public announcements, which
are identiable from headlines and extreme concurrent returns. The second source is large price
4
movements unaccompanied by any identiable news. Each month, I form portfolios of stocks
by each information source, and construct trading strategies. I examine if there is subsequent
drift or reversal, against the alternative of no abnormal returns.

I have two major results. First, stocks that had bad public news also display negative
drift. Less drift is found for stocks with good news. I interpret this to mean that prices are
slow to reect bad public news. Second, stocks that had no news stories in the event month
tend to reverse in the subsequent month. This reversal is statistically signicant, even after
controlling for size, book-to-market, and liquidity inuences. This is consistent with the view
<sup>1</sup>
Major examples of predictability in asset prices based on past returns include DeBondt and Thaler (1985),

<sup>1</sup>
Major examples of predictability in asset prices based on past returns include DeBondt and Thaler (1985),
who nd that losers outperform winners at 5 year horizons. Lo and MacKinlay (1990) also nd cross-serial
correlation at weekly lags as an explanation for portfolio momentum and individual stock reversal. Jegadeesh
and Titman (1993) discover return momentum up to 12 months. I will describe papers that deal with momentum
in more detail below.
<sup>2</sup>
Kothari and Warner (1997), Fama (1998), and Daniel, Hirshleifer, and Subrahmanyam (1998) all have

<sup>3</sup>
A classic documentation of a mismatch between fundamental news and stock prices is Shiller (1981), who
concludes that stock prices are too volatile to be explained by changes in dividends.
<sup>4</sup>
One feature of the \excess volatility" literature is that it looks at the link between news stories in the media

---

## 1 INTRODUCTION

that investors overreact to spurious price movements. However, it is also consistent with bidask bounce, although I attempt to control for this. I also nd that the eects are present,
but diminish when one eliminates low priced stocks, and are stronger among smaller stocks
than larger ones. This is not surprising if one believes that some investors are slow to react
to information, and transaction costs prevent arbitrageurs from eliminating the lag. The fact
that most drift occurs after negative returns reinforces this view, since shorting stocks is more
expensive than buying them. I also show that most bad news drift occurs in subsequent months
that did not have headlines. This implies that it takes some time to see the full impact of a
single news item on a stock, due to frictions.

My results t two old strains of thought among investment practitioners, which have
gained an academic following. First, investors are slow to respond to valid information, which
causes drift. Second, investors overreact to price shocks, causing \excess" trading volume and
volatility and leading to reversal. The results are also consistent with a richer set of theories that
try to explain short-run underreaction and long-run overreaction in terms of investor behavior.

My methodology increases our understanding of anomalies in two ways. First, I sample
all forms of news. Fama (1998) suspects that the abnormal reaction literature focuses only on
events that show interesting results. Other events that are similar but have no unusual patterns
are unreported, which gives the impression that underreaction is prevalent when it is not. My
dataset is free of selection bias. I am able to see if underreaction or overreaction remains a
feature of the data by looking at a wider class of events than has been previously examined.
Furthermore, the dataset is not restricted to events whose timing is \endogenously" determined
by corporate insiders. Those who argue that post-event patterns are explained by risk and those
who believe that securities are mispriced debate the impact of these types of announcements.
For example, post IPO or SEO underperformance could be explained by risk factors captured
by size and B/M. Or managers who see an opportunity to sell overpriced securities (which have
5
low B/M ratios and large size) might initiate IPOs. It is hard to distinguish between the
two explanations. However, the mispricing story implies that investors are slow to respond to
signals. This is not the case in the risk story. I look at this possibility for all news.

Second, I distinguish between return patterns after news events and after price shocks

<sup>5</sup>
See Loughran and Ritter (2000) for a discussion of this question.

---

that do not appear to be news motivated. I look at the dierence between the two. This adds
an important dimension to our understanding of momentum strategy payos. By construction,
these are not conditioned upon the incidence of news, but are hypothesized to arise because of
reactions to information. In addition, recent behavioral theories feature dierent reactions to
public and private signals. These two types of signals can be approximated by the two \events"
I have separated. This lets me test some implications of those models (namely, that investors
underreact to some signals and overreact to others) by looking at stock returns after public
news and periods of no news, but extreme price movements.

Hong, Lim, and Stein (2000) (\HLS") nd that smaller stocks with little analyst coverage
experience the most momentum, driven mostly by losers. Their evidence supports the view
that investors are slow to react to bad news (dened as an unconditional negative return)
unless they have \help" in the form of additional research coverage by Wall Street analysts.
My conclusions also support this view. One crucial dierence, however, is that I nd signs that
investors in smaller stocks are slow to respond to public news. No such slowness is evident
among stocks with no public news. In contrast with HLS, stocks with public news in my set
tend to be larger and probably have more analyst coverage. In other words, the underreaction
appears to result not from barriers to \knowing" news, but barriers to \understanding" it. This
is a distinction between information dissemination and information interpretation that may be
worth exploring more in the future.

drift is outlined in section 2. In section 3 I describe my dataset and present the methodology
used to construct portfolios and conduct tests in section 4. I present my results in section 5,

## 2 Literature Review

Despite forty years of research by nancial economists, the debate continues over how fast
information about a security’s value is incorporated into prices. In this section, I describe
empirical evidence of predictability in stock prices and sketch existing theories of investor
behavior. As is the case with most ideas that challenge previous paradigms, new theories came
after new evidence.

---

Most of the results of stock returns after specic news items seem to fall on the side of
underreaction, which is dened as average post-event abnormal returns of the same sign as event
date returns (abnormal or raw). The main examples include signaling events⁶ and scheduled
7 8
news releases. Investors also seem to be slow to react to capital structure changes. They
9
also seem to ignore the personal investments of managers themselves. La Porta, Lakonishok,
Shleifer, and Vishny (199<sup>7</sup>) explicitly link earnings surprise and valuation levels, showing that
high book-to-market stocks experience more positive surprises than low book-to-market stocks.

Important evidence that contradicts the view that investors underreact include results
for acquiring rms in mergers (see Agrawal, Jae, and Mandelker (1992)) and proxy ghts
(Ikenberry and Lakonishok (1993)), apparent reversal for new exchange listings (Dharan and
Ikenberry (1995)), and a host of dierent observed return patterns for IPOs, depending on the
10
horizon (Ritter (1991)). Barber and Lyon (1997) and Kothari and Warner (1997) cast doubt
on the conclusions of event studies by explaining ways in which the statistical tests used in
the above research are biased. I discuss some of their ndings below. Fama (1998) vigorously
challenges the conclusion that investors have abnormal reactions to events. He observes that
the above patterns present no consensus on investor reactions, and some disappear entirely after
11
accounting for size and book-to-market eects. Also, apparent post-event drift need not be
inconsistent with market eciency, as various shifts in risk-factor returns and changing betas
can explain some return patterns. Brown, Harlow, and Tinic (1993) examine risk changes in
response to large price swings for a group of large stocks, and nd evidence that stocks’ risk
exposure can explain post-event return dierences.
Next, I describe work on price movements not clearly motivated by news. The studies

Next, I describe work on price movements not clearly motivated by news. The studies
that describe short-term momentum (see Jegadeesh and Titman (1993)) and long-term reversal
(see DeBondt and Thaler (1985)) motivate the theories described below. However, the success

<sup>6</sup>
Dividend initiations and omissions are covered by Michaely, Thaler, and Womack (1995). Stock splits could
also fall in this category, examined recently by Ikenberry and Ramnath (2000), with similar conclusions.
<sup>7</sup>
Bernard and Thomas (1990) and others document drift after earnings surprises for up to 12 months after

<sup>7</sup>
Bernard and Thomas (1990) and others document drift after earnings surprises for up to 12 months after
the initial surprise. Michaely and Womack (1999) nd a lag in response to changes in analyst recommendations.
<sup>8</sup>
Ikenberry, Lakonishok, and Vermaelen (1995) nd drift after tender oers, and Loughran and Ritter (1995)

the initial surprise. Michaely and Womack (1999) nd a lag in response to changes in analyst recommendations.
<sup>8</sup>
Ikenberry, Lakonishok, and Vermaelen (1995) nd drift after tender oers, and Loughran and Ritter (1995)
nd it after seasoned equity oerings. Gompers and Lerner (1998) also document drift after venture capital
share distributions.
<sup>9</sup>
Seyhun (1997) nds prots to mimicking the large trades of insiders.

<sup>10</sup>
However, some argue that one can not truly know the response of stock prices to IPO announcements since
the stock does not trade when an IPO is announced.
<sup>11</sup>
Loughran and Ritter (2000) have an opposite interpretation based on the same fact.

<sup>11</sup>
Loughran and Ritter (2000) have an opposite interpretation based on the same fact.

---

## 2 LITERATURE REVIEW

of technical momentum strategies, in particular, is the most puzzling from an ecient markets
perspective. Therefore, such strategies have been linked more strongly to behavioral patterns
12
by some researchers. Momentum is robust across subperiods and appears in other markets.
13
It also distinct from post-earnings drift and reversal. One view is that momentum arises
because of investors ignore news, just as they appear to do in the case of the some event
studies. As mentioned before, HLS nd that momentum is strongest in stocks that have no
analyst coverage. They interpret this to mean that research analysts play an important role
in disseminating information. However, Lewellen (2000) has challenged the interpretation that
underreaction drives momentum. He nds no autocorrelation for portfolios, but instead a strong
cross-relation across groups of winners and losers.

Finally, there is some evidence that some investors overreact to price movements and trade
more than they should. French and Roll (1986) nd that the variance of stock returns is larger
when the market is open than when it is closed, even when similar amounts of information are
released. This implies that the act of trading increases volatility. Cutler, Poterba, and Summers
(1989) look at the relations between extreme market-wide returns and major business stories
from the New York Times. They conclude that neither economic variables nor news stories can
fully explain aggregate price movements. Roll (1988) looks at the *R²* for regressions of daily
and monthly stock returns on CAPM and APT factors and nds that much of the variance
14
in returns is unexplained. Individual investors trade too much and perform poorly relative
to buy and hold strategies. They tend to sell winners and avoid selling losers, which might
15
slow the incorporation of information into prices. In contrast, institutional investors seem to
herd¹⁶, although it is unclear whether or not this aects prices. The literature indicates that
they suer no future losses from herding.

17
In sum, many would describe underreaction to news as a \pervasive regularity", but
others would dispute that, noting that the results are inconclusive and the methodology pro-

12 Grundy and Martin (1998) show that, after accounting for potential risk factor exposures, multi-month
occurs in other countries. 13

$$
R^{2}
$$

<sup>13</sup>
Lee and Swaminathan (2000) show momentum is linked to reversal, conditional on trading volume. They
also look at it in the context of earnings drift, as do Chan, Jegadeesh, and Lakonishok (1996).
<sup>14</sup>
More recently, Mitchell and Mulherin (1994) document that while news moves aggregate market returns,

<sup>14</sup>
More recently, Mitchell and Mulherin (1994) document that while news moves aggregate market returns,
the relationship is not very strong.
<sup>15</sup>
See Barber and Odean (2000) in particular.

<sup>15</sup>
See Barber and Odean (2000) in particular.
<sup>16</sup>
See Grinblatt, Titman, and Wermers (1995) and Nofsinger and Sias (1999) for evidence in mutual funds.

<sup>16</sup>
See Grinblatt, Titman, and Wermers (1995) and Nofsinger and Sias (1999) for evidence in mutual funds.
<sup>17</sup>
See Barberis, Shleifer, and Vishny (1998), abstract.

---

blematic. Furthermore, negative return autocorrelation at very short and long lags confounds
this perceived pattern of drift. Some interpret this as evidence of overreaction.

There are three major theories that seek to explain the patterns described above. Daniel,
Hirshleifer, and Subrahmanyam (1998) (hereafter, \DHS") use two well-documented psychological characteristics, overcondence and biased self-attribution, to model investor behavior.
This results in investors holding too strongly to their own information, and discounting public
signals. Barberis, Shleifer, and Vishny (1998) (\BSV") rely on two other patterns, conservatism and the representativeness heuristic. They hypothesize that investors change sentiment
about future company earnings based on the past stream of realizations, and discount recent
information. Hong and Stein (1999) (\HS") present a model, not tied to specic psychological
biases, with two classes of traders. One group ignores the news, but reacts to prices. This
causes underreaction initially and subsequent overreaction. Naturally, all three theories generate the observed patterns. However, they dier in their specic assumptions. DHS state that
18
there will be underreaction to public information, and overreaction to private information.
BSV assume that investors will overreact or underreact to news depending on the stream of
past news. HS assume that investors will underreact to news and overreact to pure (that is,
non-information based) price movements. Since it is dicult to nd price movements that
have no component of private signals ex-ante, the assumptions of DHS and HS will be hard to
separate empirically. I will look at these assumptions by separating stocks by news incidence
using a headline database, as detailed below.

A major question I attempt to answer is: Is there a consistent pattern drift or reversal after
news? I use event study methodology that has been widely applied to earnings drift, corporate
action, and momentum research. To summarize, I collect all stocks in a given month that had
an event of interest (in this case, at least one news story). I rank all such stocks by raw returns

## 3 Analysis Methodology

## 3.1 Test Procedure

<sup>18</sup>
Their model splits signals into two groups: personal (used by informed investors only) and external (available
to all). Public information is not strictly dened; for instance, informed investors could read the newspaper and
interpret the information in a headline as a \personal" signal. However, it seems reasonable to equate public
news with external signals.

---

19
and select the top and bottom thirds. I shall refer to these two sets as \news winners" and
20
\news losers". I then examine cumulative raw and abnormal returns for up to 36 months
after the initial headline month. I also do the same for no-news stocks, as described below.

The details of my procedure are as follows. As mentioned previously, I mark the incidence
of headlines in a month instead of each headline, to mitigate the overweighting of later periods
that have more news. Having rst divided my sample by news incidence, I then divide by
performance. Using the CRSP monthly stock data series (with delisting returns), I rank all
stocks with headlines in each month by raw return. In order to be included in the ranking, the
stock must have traded during the month. I pick the top and bottom thirds as my \good news"
and \bad news" groups, respectively. I use thirds because there are few stocks in the sample in
the earliest periods. Thirds will give me a portfolio that is more diversied so that non-news
related characteristics should be less important. On the other hand, some of the \bad news"
events will in fact have positive returns, simply because the breakpoints may be positive. This
may dilute the results.

I then form monthly equal-weighted portfolios of the selected stocks. Portfolios can be
easily interpreted as trading strategies. I calculate overlapping returns for the \good news"
equal-weighted portfolio as in Jegadeesh and Titman (1993), which mitigates non-independence
in successive observations of long horizon cumulative returns. For a *J* month cumulative return
horizon, I sum the time *t* return for a portfolio formed at *t* 1 with the time *t* return for a
portfolio formed at *t* 2, a portfolio formed at *t* 3, etc. all the way to a portfolio formed
at *t J*. This sum contains the calendar time *t* returns for portfolios formed up to *J* months
in the past. Doing this for each month *t* in the dataset gives me a time series of cumulative
21
returns, none of whose observations is dependent on another. I do this for *J* between 1 and 36.
To summarize the degree of drift or reversal, I present the returns from a long-short strategy
whereby past \good news" stocks are held with positive weights, and oset short positions in
\bad news" stocks.

<sup>19</sup>
For comparison with other event studies, I also rank on idiosyncratic returns. These are the event month
residuals after subtracting returns on size and book to market (B/M) matched portfolios. The results, discussed
below, are very similar.
<sup>20</sup>
This way of separating stocks means that some good news and bad news will in fact fall out of the winner

<sup>20</sup>
This way of separating stocks means that some good news and bad news will in fact fall out of the winner
and loser categories. However, other methods of sorting news have the drawback that they rely on non-market
interpretations of news.
<sup>21</sup>
Following standard practice in similar empirical papers, I focus on cumulative returns here, although I

<sup>21</sup>
Following standard practice in similar empirical papers, I focus on cumulative returns here, although I
comment on month-by-month returns when they are illuminating.

---

The various sets of cumulated returns for overlapping portfolios can be averaged across
time. The test statistic for returns for *J* cumulative months is:

$$
\frac{A v g(P_{J})}{\sigma(P_{J})/\sqrt{T-J}}
$$

(1)

where the time series average cumulative return on the overlapping portfolios is *Avg*(*P*<sub>J</sub>), and
the time series standard deviation of the cumulative returns is (*OP*<sub>J</sub>). *T* is the number of
dates in my data, 240. For example, for the 2 month cumulative return, I start collecting twomonth cumulative returns from March 1980 all the way to December 1999. Therefore *J* = 2,
22
and *T J* = 238 is the number of months in the sample. I use three methods to calculate
23
CARs:

$$
A v g(P_{J})
$$

$$
\sigma(O P_{J})
$$

$$
J=2
$$

$$
T-J=238
$$

## 3.2 Abnormal Return Benchmarks

Abnormal returns are the residual once a proxy for expected returns is subtracted from each
month’s return. Only cumulative abnormal returns (CARs) are expected to be mean zero.
Nonetheless, I also present raw return results for comparison of magnitudes. The statistic
for CARs should be distributed unit normal if there is no systematic abnormal performance.
For good news, positive CARs indicate post event drift (consistent with underreaction), and
negative CARs indicate reversal (consistent with overreaction); vice versa for bad news.

1. CAPM: For each portfolio, each month’s abnormal return is ^<sub>it</sub>, from the model

$$
R_{i t}-r_{f t}\,\,=\,\,\alpha_{i t}+\beta_{i}\big(R_{m t}-r_{f t}\big)+\epsilon_{i t}
$$

$$
R_{m t}
$$

$$
r f{t}
$$

and R it , R mt , and r ft are the return on portfolio i (winner, loser, or long-short winnerloser), the return of the CRSP value-weighted index of all stocks, and the 1 month T-bill

month t can be derived by summing up successive returns:

<sup>22</sup>
As an alternative, I have cumulated *J* month forward returns and averaged over calendar months for most
portfolios in my analysis. I then calculated statistical signicance using Newey-West autocorrelation consistent
standard errors. In every case the results are little changed.
<sup>23</sup>
I make no explicit adjustment for momentum. I want to test reactions to news, and therefore I indirectly

$$
^{22}\mathrm{A s}
$$

<sup>23</sup>
I make no explicit adjustment for momentum. I want to test reactions to news, and therefore I indirectly
seek to test a possible cause of momentum.

---

My method of cumulating returns using overlapping portfolios allows me to estimate
P
<sup>J</sup>
<sub>j</sub><sub>=1</sub> <sub>i;t</sub><sub>+</sub><sub>j</sub>by simply regression. This can be seen by slightly modifying the above expression (and dropping the *i* portfolio identier) to produce:

$$
\sum_{j=1}^{J}\alpha_{i,t+j}
$$

$$
\sum_{j=1}^{J}R_{t,t-j}\;\;=\;\;J r_{f,t}+\sum_{j=1}^{J}\alpha_{t,t-j}+\sum_{j=1}^{J}(\beta_{t-j})\left[(R_{m,t}-r_{f,t})\right]+\sum_{j=1}^{J}\epsilon_{t,t-j}
$$

(4)

where *R*<sub>t;t</sub> <sub>j</sub>now denotes the time *t* return of a portfolio created at month *t j*,<sub>t</sub> <sub>j</sub>is
the beta of the portfolio, and<sub>t;t</sub> <sub>j</sub>is the time *t* error term for the portfolio. Thus I can
P
J
calculatej=0 t;t jas the constant term in a regression of time t summed overlapping
portfolio returns minus <sup>J</sup> *t*imes *t*he time t riskfree rate on time *t* market excess returns.
This time-series regression allows me to use all observations.

$$
R_{t,t-j}
$$

$$
t-j,\beta_{t-j}
$$

$$
\epsilon_{t,t-j}
$$

$$
\sum_{j=0}^{J}\alpha_{t,t-j}
$$

2. Fama French 3-Factor Model: Monthly abnormal return is ^<sub>it</sub>, from the model

$$
\hat{\alpha}_{i t}
$$

(5)

$$
R_{i t}-r_{f t}\;\;=\;\;\alpha_{i t}+\beta_{i1}(R_{m t}-r_{f t})+\beta_{i2}\mathit{S M B}_{t}+\beta_{i3}\mathit{H M L}_{t}+\epsilon_{i t}
$$

and SMB<sub>t</sub>and HML<sub>t</sub>are the Fama-French size and book-to-market factor mimicking
portfolio returns at time *t*, respectively. I estimate the cumulative 3-factor \alpha" by
using the same time series regression of summed time *t* overlapping portfolio excess returns
24
on time *t* factor returns.

be better predictors of future returns than factor betas. Instead of using regressions to

$$
\mathrm{S M B_{t}}
$$

$$
\mathrm{H M L}_{t}
$$

Another question I attempt to answer is: Is there predictable drift or reversal after pure
price movements? I conduct the analysis on two other portfolios. One has past returns that
are similar to those of the \news" group but that are chosen solely based on past performance.
Each month I sort all subset stocks by returns and pick the top and bottom thirds as winners
and losers, respectively. This is the \all" set. I use a dierent set of return breakpoints to
separate winners and losers because I want to see how a pure 1-month momentum strategy

<sup>24</sup>
SMB, HML, and market data are obtained from Ken French via his website.
<sup>25</sup>
I describe the matching methodology more fully in the next section.

---

would do. I continue to use thirds, however, to make the \all" results roughly comparable to
26
the news and no-news returns. Another has stocks with no news headlines (the \no-news"
portfolio). Each month, I use the news return breakpoints to select a group of winner and loser
stocks from among the monthly no-news set. No-news stock returns could reect reactions to
private signals, news not covered by my sources, or supply and demand shocks. One can also
think of no-news as a benchmark for the news portfolio return, since they have similar event
date returns. Again, in order to be included in the analysis, each stock in the two other groups
must have traded during the month. I repeat the computation of CARs and long-short portfolio
payos as above for both sets. This helps us to understand stock behavior after signals from
dierent sources, namely public announcements vs. price movements.

The additional analysis of all and no-news stocks will also help me to address some
problems with long-run event studies that are identied by Barber and Lyon (1997) and Kothari
and Warner (1997). For instance, most cumulative and buy-and-hold abnormal returns appear
27
positive, regardless of the sample. Also, various data requirements for a sample bias the
abnormal returns. This causes the tests to have low power. Both the \news" and \no-news"
samples may suer from the problems mentioned in these papers. However, the dierence
between the two sets of returns should still tell us something denitive about how news aects
stocks, under the hypothesis that misspecication aects both samples in more or less the same
way.

Since I examine stock price reactions to public news, I need to know when information was
released. I use the Dow Jones Interactive Publications Library of past newspapers, periodicals,
and newswires. This database has abstracts and articles from many sources, going back to
before 1980. However, the inception dates for coverage of dierent sources vary. Some are
included for the entire period in which they published, and others are only available after being
26
The breakpoints are not very dierent, although on average news stocks have slightly higher event month

<sup>26</sup>
The breakpoints are not very dierent, although on average news stocks have slightly higher event month
returns than \all" stocks. I have compared the results of my \all" set with those for the entire CRSP database
in the same period. The results are similar in magnitude and sign for almost all horizons.
<sup>27</sup>
In this paper, I mainly test cumulative abnormal returns (CARs), although I discuss one set of results for

in the same period. The results are similar in magnitude and sign for almost all horizons.
<sup>27</sup>
In this paper, I mainly test cumulative abnormal returns (CARs), although I discuss one set of results for
buy-and-hold abnormal returns (BHARs). The results of the Kothari and Warner study motivate me to do this
because their simulation results indicate that, if anything, the latter are more misleading than the former. My
CARs have less cumulation bias due to bid-ask spread, since I cumulate monthly returns, which exhibit less
bid-ask bounce than weekly returns. Roll (1983) describes this problem.

---

archived in electronic format. To get around the problem of spotty data, I select only those
publications with most recent circulations over 500,000, daily publication, and stories available
28
over as much of the 1980-1999 period as possible. For each company in my set, I select all
dates when the stock was mentioned in the headline or lead paragraph of an article from the
sources. In order to reduce the over counting of news about the same subject from multiple
sources, I note only if there was news on a particular day, not how many stories appeared. While
my data lter does pull the text of headlines that give the content of the news, I choose to focus
on the simple occurrence of news stories. I do not include magazines, since it is slightly more
dicult to pinpoint on which day or week they became publicly available. Also not covered
are investment newsletters, analyst reports, and other sources not available to the broadest
audience. My focus is not on the forecasting performance of various information sources, but
on how investors react to public news.

The sources are weighted by coverage towards the later part of the 1980s and 1990s. As
a result, I may miss a larger fraction of news events early in my sample period. However, by
far the sources with the most complete coverage across time and stocks are the Dow Jones
newswires. Wall Street professionals see these newswire stories as they are released, and thus
they are the best approximation of public news for traders. This source does not suer from
gaps in coverage. Furthermore, I group news events over days and also a month-long window as
detailed below. This reduces the chance that later periods, which usually have multiple news
29
items on a single day, are over weighted.

Since data retrieval is time consuming and labor intensive, I focus on a subset of CRSP
stocks. I randomly select approximately 1*=*10th of all stocks that existed at any time between
30
January 1980 and December 1999. This results in a set of 1557 stocks, with 280 in existence
at the end of January 1980 and almost 600 at the end of December 1999. I then collect all
available news for these stocks. Table 1 shows counts of stocks in subsets for some months. As

<sup>28</sup>
The resulting list of data sources, with their coverage dates, follows: The Wall Street Journal (all editions)
from 1977-present, Associated Press Newswire from 1985, the Chicago Tribune from 1989, the Globe and Mail
(for coverage of a few Canadian companies) from 1977, Gannett New Service from 1987, the Los Angeles Times
from 1985, the New York Times from 1980, the Washington Post from 1984, USA Today from 1987, and all
Dow Jones newswires from 1979.
<sup>29</sup>
I exclude all sources other than the Dow Jones newswire and Wall Street Journal and redo the analysis.

<sup>29</sup>
I exclude all sources other than the Dow Jones newswire and Wall Street Journal and redo the analysis.
The results are virtually unchanged, even in later periods.
<sup>30</sup>
I sort all stocks that existed at any time from 1980 to 1999 by CRSP permno and pick every 10th number.

<sup>30</sup>
I sort all stocks that existed at any time from 1980 to 1999 by CRSP permno and pick every 10th number.
This method accounts for the fact that companies that were listed around the same time have CRSP permnos
that tend to cluster together.

---

can be seen from the rst few columns of Panel A, roughly half of my subset of stocks has some
news in each month. The proportion ranges from 40% at the start of the period to 60% at
the end of the period. On average less than 5%, however, have news on more than 5 days in a
month, although that percentage increases through time. The increasing number of days with
news is consistent with improving media coverage. The numerous stocks for which there was
news each month also suggests that my dataset of headlines do not consist solely of previously
studied corporate actions.

31
Panel B presents correlations of news citations with a few rm characteristics. Stocks
with headlines are not small stocks for which one might expect to nd more asset-pricing
anomalies. Cross-sectionally, the correlations of log market value on log citations per month
(logs for rescaling since both market value and citation incidence are positively skewed) range
from 0.2 to 0.6, with the time series average across months at 0.4. For the vast majority
of months the correlation is above 0.3. The positive relationship between size and coverage is
reasonable, given the costs reporters face nding information for smaller stocks (and the limited
market for such news).

News citations per month have weak positive correlation coecients of 0.01 with returns.
There is large dispersion over time in the cross sectional correlation, although the relation is
still statistically signicant. The occurrence of headlines is more strongly related to turnover.
The correlations range from -0.1 to 0.6, and average about 0.15. I conclude that headlines do
not seem to favor good news (denoted by high returns). Also, depending on one’s interpretation
of turnover, one could infer that highly liquid and/or more controversial stocks attract more
media attention. Alternatively, one might believe that news causes more trading for risk sharing
32
purposes when it is released.

Table 2 presents summary statistics for my winner and loser groups, and shows December
values in detail. One can see that winners tend to be larger than losers (with exceptions in the
early 1980s). News stocks are usually larger than unconditionally selected momentum stocks,

<sup>31</sup>
Rank correlations are almost identical.
<sup>32</sup>
The preliminary analysis suggests some potentially interesting research tangents. One could see if there is

<sup>32</sup>
The preliminary analysis suggests some potentially interesting research tangents. One could see if there is
a dierence between stocks that experience more trading and numerous headlines, vs. stocks that experience
more trading without news. One could also look at aggregate market returns and volatility when many stocks
have news, vs. when there is little news; see Mitchell and Mulherin (1994). However, the current data set may
be too small for such detailed analysis.

---

smaller stocks are more volatile, and larger stocks have more news. Losers grow over time.
In December 1980, the average market capitalization of all losers was $89 million, vs. $214
million for news losers, and $51 million for no-news losers. By December 1999, all, news, and
no-news loser portfolios averaged $770 million, $2,064 million, and $155 million, respectively.
Winners also show a dramatic shift in size. In December 1980, all winners averaged $483
million, news winners average $403 million, and no-news winners average $236 million. The
gures for winners in December 1999 are $1,252 million, $1,326 million, and $413 million for all,
news, and no-news winners, respectively. Therefore, most selected stocks would be considered
small-cap, although some of the news stocks at later dates and winners might be classied as
mid-caps, since they average over $1 billion in a few months. One should note that no-news
stocks might be more subject to microstructure movements since they are typically very small.
These averages conceal large variations in market valuations, but are an appropriate way of
viewing the portfolio since I equal-weight observations.

How much overlap is there between all the sets? The all set is simply the union of the

Table 1). The proportion of news stocks rises rapidly from about 40% in the early 1980s to

over the 20-year sample period even though the number of stocks under consideration rises.

The all and news breakpoints are roughly equal. News, no-news and all portfolios have
similar event month (time *t*) returns as shown in the last six columns of Table 2. However,
no-news returns are more extreme in the tails. Finally, none of the winner or loser portfolios
are extremely concentrated by industry. I classify all portfolio stocks by the 20 industries
used by Grinblatt and Moskowitz (1999), and calculate the cross sectional Herndahl index for
33
each month. The monthly Herndahl averages (not shown) are remarkably uniform across
P20
<sup>33</sup>
My Herndahl index isi=1~~P~~²<sub>i</sub>t, where P<sub>it</sub>is the percentage of stocks in industry *i* in month *t*. This is a

$$
\textstyle\sum_{i=1}^{20}P_{i t}^{2}
$$

$$
P_{i t}
$$ news/no-news and winner/loser categories, at about 16%. Given an average of 15 industries
per portfolio each month, this implies that a single industry could account for at most about
a third of the portfolio. Even this is unlikely given the numerous stocks with headlines in the
month, especially in later periods (e.g. over 100 in the 1990s).

Table 3 shows some details of news stories for two companies in the news strategy. Summaries for Jacobs Engineering (ticker JEC) are shown for 1983-1987 in the top panel, and news
for Super Valu Stores (ticker SVU) from 1993-1997 is shown in the bottom panel. I selected
these stocks since they were among the issues that existed for the full 1980-1999 period; however, only some months are displayed to save space. Super Valu has been a component of the
S&P500 over the 1985-2000 period and would be considered a large-cap stock. Jacobs Engineering has been a component of the S&P400 since the index was created and would be considered
a mid-cap. \Winner" or \loser" designation within the news strategy, and the contemporaneous
return, are shown in the left columns. This table highlights some features of the data.

First, the news includes many corporate actions such as mergers and tender oers, as
well as earnings announcements. These are also often accompanied by other news. However,
my news set misses some earnings announcements. Furthermore, many news \events" are not
corporate actions or pre-scheduled earnings releases. These include analyst ratings changes,
capital spending announcements, blockholder sales and purchases, and new contracts. Second,
there are some months when a reading of the headline does not reveal if the news was good
or bad. For example, acquisitions and ratings changes are accompanied by both positive and
negative returns. This suggests that it may be wise to rely on the market reaction to lter
\good" and \bad" news. Third, the \winner" and \loser" categories are broad because I use
thirds to divide rms by returns. For instance, some stocks display zero or slightly positive
returns in some months, but may be classied as \losers", based on relative performance.
Finally, news does not appear autocorrelated, since a single stock can switch from being a news
winner to a news loser several times in a year. This implies that any post-news patterns are due
to reactions to single news events, and not the accumulated reaction to multiple news events
34
over an extended period.

measure of the industry concentration of the portfolio each month.
<sup>34</sup>
This is conrmed by looking at the transition probabilities of stocks in each of the news/no-news winner and

<sup>34</sup>
This is conrmed by looking at the transition probabilities of stocks in each of the news/no-news winner and
loser groups. The average proportion of stocks in the 4 categories (news winner, news loser, no-news winner,
no-news loser ) switching into another category (news winner, news loser, no-news winner, no-news loser, news
middle third, or no-news middle third) over subsequent post-formation months is roughly equal. The only thing

---

It is important to examine this last point further. Learning more about the typical pattern
of drift or reversal will tell us more about what drives it. Are people \serially surprised" by
news? Do they face frictions that would explain any patterns? I turn to this issue in the last
part of the paper.

## 4 Results

## 4.1 Raw Returns

I rst present the long-short strategy raw returns to news, no-news and all portfolios in Table 4.
Panel A of Table 4 shows cumulative returns to the long-short zero investment strategy, out to
3 years after the event month. Separating stocks on news incidence causes dramatic dierences
even in rst month returns. While there are no statistically signicant signs that the long-short
strategy is protable for all and no-news sets, it is for the news set, which returns nearly 6% in
35
the rst twelve months. For the rst month, returns are negative, especially for the no-news
strategy, which loses almost 2%. This is in line with the results of Lo and MacKinlay (1990),
who document positive returns to a short-term contrarian strategy up to one month. It takes
the all strategy almost half a year to recover from the eects of the *t* + 1 reversal. In contrast,
not only do the news stocks experience less reversal in month *t* + 1, they also have more drift
than all stocks for most of the following year. There are also some large negative returns beyond
the 12-month horizon for news stocks, although they are not enough eliminate the early drift.
The dierence between news and all returns is statistically signicant in the rst 12 months.

Month-by-month returns (not shown) are particularly large 3, 6, 9, and 12 months after *t*0,
approaching 1 percent a month for the news subset, which suggests that earnings drift may be a
driver of the long-short returns I observe. Chan, Jegadeesh, and Lakonishok (1996) and Bernard
and Thomas (1990) explicitly look at prots to long-short strategies based on abnormal returns
around 1-4 quarters past earnings announcements, and nd strong momentum. My news set
contains about 80% of stocks in the CRSP subsample that make earnings announcements (as
that can be said is that news stocks tend to have news in subsequent months, and no-news stocks do not.

that can be said is that news stocks tend to have news in subsequent months, and no-news stocks do not.
<sup>35</sup>
One would expect that winners selected in month *t* would outperform losers on average through months

<sup>35</sup>
One would expect that winners selected in month *t* would outperform losers on average through months
*t*0 + 1 to *t*0 + 36, because winners more often than not have higher expected returns than losers. This point
is made by Conrad and Kaul (1998). Lewellen (2000), however, notes that 1-12 month returns are too noisy
to accurately estimate mean returns of stocks. Therefore, this motivation for the success of momentum-like
strategies is not extremely compelling.

$$
t0+1
$$

$$
t0+36
$$ recorded on IBES) in a given month. This is important because whatever results I nd may be
largely driven by the earnings drift phenomenon. Later, I eliminate earnings announcements
from my sample and redo the analysis. As discussed below, earnings announcement returns
are important, but the news drift remains economically and statistically signicant even after
excluding them.

A long-short strategy using no-news stocks experiences a loss in the rst month, followed
by essentially zero prots thereafter. This pattern of returns is consistent with an interpretation
of no-news shocks as having a temporary component, due to overreaction. It is also consistent
with microstructure eects like bid-ask bounce. To examine this possibility, I wait one week
after forming portfolios before investing in the strategy. This is the procedure typically used
in momentum strategy calculations. It reduces the chance that short-term microstructure
movements inuence the subsequent cumulative returns. The results in Table 4, Panel B,
indicated that no-news stocks continue to have strong reversal in the rst month, whereas the
news set has none. While waiting a week cuts the negative cumulative return for no-news
stocks roughly in half by month 6 and month 9, it does not eliminate it. In contrast, the news
long-short strategy is even more protable and has no reversal in the rst month.

Without a doubt, the stronger pattern is that of drift after new events, while the rst
month reversal eect for no-news stocks is economically and statistically less signicant. Skipping a week may not eliminate all of the microstructure eects, and therefore one might still
have doubts that the reversal eect is due to overreaction. This is certainly valid, but skipping
an entire month would make it impossible for me to study any short term eects (although
doing so strengthens my post-news drift ndings considerably). I continue to comment on rst
month eects since they appear in all of my later adjustments. The no-news reversal pattern
is fairly robust, if not large.

the losers. They do markedly worse in the news set than in the no-news set. The only dierence
between winners lies in the rst month, when no-news winners reverse and news winners do

---

This preliminary, unadjusted evidence suggests an asymmetric response to information.
A news long-short strategy earns money and a no-news strategy loses money. Risk changes
are unlikely to explain the entire story. Since no-news winners do not outperform losers over
the rest of the 3-year period, they do not seem to have higher expected returns. Therefore
we can discount dierences in risk characteristics as an explanation for the reversal pattern.
Furthermore, bad news would have to make stocks less risky, and good news would have to
increase risk, in order to explain the drift in actual returns.

## 4.2 3-Factor and CAPM Abnormal Returns

Without modeling systematic risk of stock returns, one cannot say if stock prices depart from
rationality. In the following sections I discuss cumulative abnormal returns.

CAPM and Fama French 3-factor adjusted returns tell essentially the same story as was
seen in the raw returns of Table 4. I display 3-factor cumulative alphas in Table 5, with
long short, winner, and loser performance in Panels A, B, and C, respectively. First, *t*0 3-
factor adjusted returns are similar for news and no-news sets, whether one looks at winners or
losers. Again, the news long-short strategy is steadily protable, whereas the no-news longshort strategy loses money. No-news losses are driven by month 1 reversal, for both winners
and losers, as can be seen in Panels B and C. Subsequent no-news performance is largely at.
News stocks exhibit no reversal in the rst months, and news losers have persistent and large
negative alphas, far below those of no-news losers.

CAPM results (not shown) are very similar to those for the 3-factor model. News losers
exhibit the same pattern of persistent negative abnormal returns, and no-news stocks experience
month 1 reversal. Also, *t*0 abnormal returns are very similar for news and no-news portfolios,
within performance groups. For example, news losers return a cumulative CAPM alpha of
-7.8% after 12 months (t-statistic 2.5), vs. a cumulative 3-factor alpha of -6.9%. long-short
strategy prots are largely unchanged, at about 5.8% after twelve months (t-statistic 4.7) vs.
6.2% for 3-factor the adjustment.

In summary, the following patterns stand out: even after making some adjustments no-

---

36
momentum strategy returns in previous studies.

At this point I should comment on long-run abnormal returns. As is generally the case
for all the following subsets, they seem to exhibit reversal around the two-year mark or beyond,
so that any gains from the long-short strategy are almost eliminated. This is true for sorts in
the next sections. However, the dierence between news and no-news long-term performance
on a month-by-month basis is rarely statistically signicant. I include long-term returns mainly
to see if short-term eects are transitory, and I cannot rule that out. However, I am reluctant
to draw further inferences from them, for several reasons. First, there is the chance that the
expected returns models I use are misspecied. Barber and Lyon (1997) and Kothari and
Warner (1997) show that this becomes more of a problem as time goes on. However, I believe
that misspecication is not a crippling problem in the short term, and I generally nd zero
abnormal returns in most months beyond the rst few. Second, in my 19 year sample period
there are only six completely non-overlapping 3-year returns, a very small sample. Many authors
show that overlapping returns do not necessarily improve the quality of statistical inferences
at very long horizons (see, in particular, Richardson and Stock (1989) on the poor asymptotic
properties of a particular test of predictability). Third, it is conceptually harder to justify longrun movements in stock returns as a response to publicly available news than it is to explain
short-term movements, especially when intervening periods show no particular abnormal return
pattern. I present cumulative returns out to the third year, however, for the interested reader.
4.3 Size and Book-to-Market Portfolio Matched Returns

## 4.3 Size and Book-to-Market Portfolio Matched Returns

in the CRSP database with book value³⁷ using a method outlined by Fama and French (1992)
and duplicated by La Porta, Lakonishok, Shleifer, and Vishny (1997), and Daniel and Titman
(1997), among others. For June of each year t , all stocks are formed into 25 portfolios by size

for B/M. Only stocks on the New York Stock Exchange having positive book values are used to

<sup>36</sup>
In fact, Grundy and Martin (1998) show that 3-factor adjustments make momentum strategy returns larger
and more stable. This appears to be the case here, at least to the twelve-month horizon.
<sup>37</sup>
Data item 60 on the Compustat tapes. I merge using the CRSP/Compustat merged database.

<sup>37</sup>
Data item 60 on the Compustat tapes. I merge using the CRSP/Compustat merged database.

---

calculate the 5 size and 5 B/M breakpoints. The resulting portfolios are then equal weighted,
38
and I calculate 25 sets of monthly returns.

At the end of June of every year, each stock in my subsample of over 1500 stocks is
assigned to one of these 25 portfolios. If it cannot be found within one of the 25 portfolios,
it is not used. I lose about 25% of the original sample stocks each month, with slightly less
lost in the beginning of the period (18% in January 1980), and more in the later dates (37% in
December 1999). This is due to the merging criteria, since I require data from the previous year
as well as each June. On average, the resulting stocks are slightly larger than those without
the size and book-to-market requirements. Averaged through time, about 20% fewer news and
25% fewer no-news winners and losers survive.

I then subtract the size and book-to-market matched portfolio return from each stock’s
return each month. This gives me a time series of adjusted returns, which I cumulate and test
as before. Finally, I skip the rst week after portfolio formation before investing. As in Table
4, Panel B, this is meant to exclude microstructure eects from contaminating the protability
of the strategy.

I present size and B/M adjusted data in Table 6. In general, the results are the same.
The portfolio matching method lessens the protability of the news strategy and increases the
losses to the no-news strategy when compared with the regression approach (compare Table
6 with Tables 3 and 4). News winners display little discernible pattern. The reversal for the
no-news winner group is statistically signicant at the 1% level. However, the *t*0 + 1 returns are
very small relative to the *t*0 run-up, at -0.6% vs. 16.3% for no-news stocks. More strikingly,
there is almost no dierence between the two winner sets, except for the rst few months. From
Panel C, one can see that the same pattern of reversal followed by zero abnormal returns is
present for no-news losers. They gain back over 8% of the return they had lost in the previous
month (0.7% following a 13.7% drop), a larger reversal than seen in the winners. News losers,
however, experience no reversal in the rst month. The rst month no-news reversal results,
for both winners and losers, are consistent with the hypothesis that large price swings contain
an element of overreaction.
<sup>38</sup>
I construct my own size and B/M portfolios to be consistent with how I measure size and B/M for individual stocks. My portfolios are over 90% correlated with those from Ken French’s website, but are not as

<sup>38</sup>
I construct my own size and B/M portfolios to be consistent with how I measure size and B/M for individual stocks. My portfolios are over 90% correlated with those from Ken French’s website, but are not as
comprehensive.

---

Post-news drift is clear from the positive returns to the news long-short strategy. One
dierence between the results of Table 6 and those of Table 4 and the 3-factor regressions
in Table 5 is that now the post-news drift is somewhat driven by news winners in addition
to the news losers. The cumulated abnormal return at twelve months for news winners is
1.7% (signicant at the 10% level) and for news losers is -3.3% (signicant at the 5% level).
However, several facts reinforce the original nding that losers drive post-news drift. First, the
news strategy long-short prot is economically and statistically large at twelve months, while
the no-news strategy loses money. Second, the dierence between news and no-news returns
is biggest for the losers. Third, almost all of my later adjustments (most of which lessen the
impact of the smallest stocks) conrm that news losers have drift, but news winners do not.
In particular, I nd that all of the \news winner drift" is due to post earnings drift. These
facts, combined with the 3-factor and raw results, support the view that investors primarily
underreact to bad news.

In summary, the results of the size and book-to-market adjustment give further weight to
the interpretation of underreaction to news. The CAR spreads I have found average around 4%
to 6% by month 12, depending on the model of expected returns. While these may seem large,
they are reasonable when compared to the results of other studies. Abarbanell and Bernard
(1992) nd size adjusted CARs of 8% for a strategy of longing positive and shorting negative
earnings surprise stocks from 1976-1986, and Bernard and Thomas (1990) nd long-short CARs
of between 4% and 10%. The studies use quintiles and deciles, respectively, while I use thirds.
Various horizon momentum strategies also return anywhere from 8% to 12% a year. Grundy
and Martin (1998) show that a 6-month past momentum strategy that skips a month before
investment earns a 3-factor adjusted return of 1% a month. Therefore, my results are well
within the boundaries of those for previous event and momentum studies.

returns may mean that the models are misspecied. Another view might be that the models are

Underreaction could be pervasive enough that a randomly selected benchmark group of stocks

---

CARs calculated by various models tend to be positive, I nd little evidence of sustained
positive abnormal returns for any subset of stocks. Instead, the strongest pattern is of negative
CARs for bad news events, as will be reinforced below.

## 4.4 Other Adjustments

In this section, I adjust the methodology and sample, to account for previously discovered eects
and explore further the drift for bad news stocks I have found. For comparison, I continue to
use size and B/M adjusted returns like those in Table 6. Again, in all cases, I skip the rst
week after formation before investing. The results for long-short strategies are shown in the
various panels of Table 7.

## 4.4.1 Buy and Hold Abnormal Returns (BHARs)

is economically costly as a trading strategy. Re-balancing to get CARs also tends to overstate

Returns (BHARs) reect the prots to a more feasible trading strategy. Furthermore, if most

drive the entire eect. BHARs would address this by putting more emphasis on relatively larger

I repeat the size and B/M adjusted analysis, but maintain the weightings over months so
that the event-time portfolio performance shows the time *t*0 + *J* value of investing $1 in each
stock at time *t*0. Again, the results (Table 7, Panel A) are little changed. The news long-short
strategy is protable, while the no-news long-short strategy is unprotable. The dierence is
statistically signicant in all months but the rst. The no-news strategy loses less, and the
news strategy prots are a bit smaller using BHARs than with CARs (compare the numbers
above with Table 6). Losers are the major reason for the dierence between news and no-news
strategy returns. They return -3.5% (t-statistic -5.4) at 12 months. The dierence in news and
no-news loser cumulative returns is statistically signicant at the 1% level for all months, while
the dierence for winners is not beyond the rst 3 months. Also, both no-news winners and losers reverse, while neither news winners or losers do.

## 4.4.2 Ranking on Event Month Abnormal Returns

Most studies measure the abnormal return around the event for each stock. The interpretation
is that the *t*0 idiosyncratic returns reect rm specic information, and subsequent abnormal
returns show investor under or over-reaction to this type of news. I repeat the analysis above,
ranking on event month size and B/M adjusted returns instead of raw returns. Note that the
estimated *t*0 abnormal returns will be noisy. The results (Table 7, Panel B) are essentially
unchanged. Idiosyncratic news drift is less pronounced. Again, news losers play a larger role
in the dierence between news and no-news portfolios. They return -3.2% (t-statistic -2.4) at
twelve months. Stocks ranked by no-news idiosyncratic returns also show strong reversal in
the rst month, while news stocks do not reverse. Both no-news winners and losers contribute
to this. The cumulative return dierence between news and no-news losers is statistically
signicant at the 1% level for all months, but not for winners beyond the rst 3 months.

## 4.4.3 Weighting Stocks by Frequency of News within the Event Month

Investors may give less weight to news from only one or two days, and more to news that is
repeated over several days. The impact of an announcement may be complex and professional
investment analysts and reporters might need time to discover the full story. Therefore, stocks
with news over several days should show less drift. One way to observe this would be to weight
each stock in a month by the number of days on which it had a headline when forming news
portfolios. If there is less drift, we may conclude that investors underreact less to many headlines
than to a few news stories. An alternative view might be that investors’ underreaction is
proportional to the amount of information they receive, which would mean that more headlines
implies more underreaction.

---

portfolio returns are of course unchanged from Table 6. The dierences between news and nonews strategy returns are large and statistically signicant at the 1% level in the rst month,
and beyond for losers. It is not surprising that there is little change from previous results, since
extreme return stocks probably have more news. Weighting by number of headlines, however,
does reduce the inuence of the smallest stocks, since headline incidence and size are correlated.

## 4.4.4 Excluding Earnings Announcement Months

As noted before, some of my set of news headlines includes earnings announcements, and
39
therefore my ndings undoubtedly incorporate previously discovered post-earnings drift. Do
the responses to earnings announcements drive my results? To answer this question, I repeat
the size and B/M adjusted analysis (using raw returns to rank *t*0 stocks), but exclude all stocks
40
that had a known earnings announcement in the event month from my set of observations. A
few no-news stocks are dropped, since they apparently had earnings announcements that were
not publicized in my headline database.

Even after excluding earnings months, the results (Table 7, Panel D) are comparable to
those in Table 5. Long-short adjusted prots to a news strategy are smaller (around 4% twelve
months after formation vs.nearly 5% with earnings announcement stocks included) but still
large and statistically signicant at the 1% level. The dierence between news and no-news
long-short strategy is still economically large at 12 months and statistically signicant when
compared to Table 6. For winners, the news set experiences a reversal (-0.6% vs. 0.1% for
Table 6 news winner returns in the rst month) and has an adjusted cumulative return of 0.5%
12 months after formation (vs. 1.7%). No-news winners show little change (unsurprising, since
they contain few earnings announcement stocks), and the dierence between news and no-news
winners is smaller in all months. News losers excluding earnings announcement stocks have
lower returns than those in Table 5, Panel C. They reach a cumulative 12-month return of
-4.4% (t-statistic 2.9). No-news losers are largely unchanged. The dierence between news and
<sup>39</sup>
Earnings announcement stocks make up on average about a third of all news stocks each month.

<sup>39</sup>
Earnings announcement stocks make up on average about a third of all news stocks each month.
<sup>40</sup>
I rst check to see if my sample exhibits earnings momentum. I select all stocks that had an earnings

Earnings announcement stocks make up on average about a third of all news stocks each month.
<sup>40</sup>
I rst check to see if my sample exhibits earnings momentum. I select all stocks that had an earnings
announcement in each month, and repeat the idiosyncratic return analysis adjusting for size and book-tomarket and skipping the rst week. Similar studies usually use deciles instead of thirds. I nd large and
statistically signicant abnormal returns of 0.9%, 1.0%, 0.4%, and 0.5% in the third, sixth, ninth, and twelfth
month after the announcement, respectively. The cumulative twelve month abnormal return is nearly 4.6%.
Therefore my sample does seem to exhibit earnings momentum.

---

no-news returns is larger for losers, reaching nearly -7.3% in month 12 vs. the -5.6% found
in Table 5 (t-statistics of -4.5 vs.-3.6). I conclude that post earnings announcement drift,
while important, does not drive all of the results of underreaction I have found. One important
thing to note is that excluding stocks that had earnings announcements eliminates any trace of
post-news-winner drift. This implies that investors do not appear to underreact to good news,
aside from positive earnings announcements.

## 4.4.5 The Eects of Size: Value Weighting

Fama (1998) has noted that in many studies, abnormal returns shrink or disappear altogether
when the observations are weighted by market value. I explore that conclusion in Table 7, Panel
E. The object is to nd if the observed rst month reversal and loser drift are stronger in small
stocks. If so, such patterns would be economically less important, although still a matter of
concern for some corporate managers and their investors. One should note that value weighting
results in very high weight given to a few such behemoths as Disney. Very small weights are
assigned to the multitudes of smaller stocks that make up the majority of observations in my
winner and loser portfolios, since market valuations are highly right skewed.

Size and B/M adjusted long-short strategy returns show much less drift, although the
news long-short portfolio returns over 1.6% at twelve months. However, the no-news strategy
earns more money over 12 months. The *t*0 news returns are also less extreme than those
of the no-news set. The CARs for news winner stocks are very small in absolute terms and
statistically indistinguishable from zero. However, no-news winner reversal is still present.
There is a pattern of negative adjusted returns over the subsequent twelve months for news
loser stocks (-2.6% after 12 months), which is not statistically signicant at the 5% condence
level. However, a similar pattern is also observed among the no-news loser set, which continues
to display reversal in the rst month. In every month, the dierence between news and no-news
winner and loser returns is virtually zero. I conclude that any bad news underreaction found
for news stocks are more prevalent for smaller stocks than for larger stocks. In this respect, my
results are no dierent from those found in most other studies of post-event reactions. Some
reversal for no-news stocks seems to remain, however, even when giving much more weight to
large companies.

---

## 4.4.6 Excluding Low-Priced Stocks

It may not be protable to attempt to \arbitrage away" apparent underreaction, since much
of the drift eect seems to be driven by smaller stocks. These tend to be more illiquid, and
have higher direct transactions costs as a percentage of any position. Large transactions would
probably have a large price impact. This might explain why the drift eect seems to persist,
although not why it arises in the rst place. One way to see how liquidity aects the drift
pattern is to exclude those stocks that have high direct transactions costs. I repeat the size
and B/M adjusted analysis of Table 6, but eliminate all stocks with prices of $5 or less from
my sample. My remaining sample should consist of more liquid stocks, since price is related to
ease of buying or selling. I could also examine trading volume and bid-ask spread, but these
41
too are imperfect measures of liquidity.

Dropping low-priced stocks further reduces the sample. In the CRSP database for this
period, on average, 28% of observations (stocks in all months) are priced at $5 or below. The
no-news stocks in my size and B/M matched subsample contain more low priced stocks; 24%
of my news winners and losers are low-priced, while many more no-news stocks fall out of the
analysis (44% and 40% of no-news losers and winners, respectively). The resulting portfolios of
winners and losers have much less extreme returns in the event month. Loser returns average
about -10% in the event month for \all", news and no-news portfolios. Winner returns average
about 13% (compare these with the average returns in the last 6 columns of Table 2). Also, my
remaining sample consists of larger stocks. Loser news and no-news portfolios average about
$785 million and $251 million, respectively, while winner news and no-news portfolios average
$851 million and $303 million. These are much larger averages than those used in the original
42
analysis.

<sup>41</sup>
Weighting portfolio stocks by event month turnover gives similar results. Month *t*0+1 no-news losers return
0.3% (t-statistic 1.0) and no-news winners return -0.8% (t-statistic -3.0). News stocks show no reversal, and
news long-short returns are 7.3% at month 12 (t-statistic 4.6). Losers drive news drift. Weighting portfolio
stocks by absolute volume in the event month is problematic, given that shares traded have little relation to
value traded. However, no-news reversal and news drift are still present, if less strong. News long-short 12-
month returns are 4.6% (t-statistic 2.9) and news stocks show no *t*0 + 1 reversal, while no-news stocks return
-1.2% (t-statistic -3.2) in month *t*0 + 1 and almost nothing thereafter.
<sup>42</sup>
The summary statistics shown in Table 2 are not exactly comparable to those I describe here. Table 2 shows

---

The CARs of the reduced set (shown in Table 7, Panel F) are similar to those of Table
6. News drift is still present, and no-news stock returns are closer to zero, although rst
month returns still shows reversal. The dierence between news and no-news strategy payos
is smaller, but still statistically signicant. Again, the news loser drift drives all of the news
strategy protability. News loser 12-month cumulative returns are -3.9% (t-statistic -3.8), which
is much dierent from the no-news loser cumulative return of close to zero. News winners have
no drift. Moreover, both no-news losers and winners continue to have reversal. This pattern,
however, is much weaker and not statistically signicant. At two and three years after portfolio
formation, there is no noticeable change in patterns for any set.

The news loser drift pattern is still economically and statistically signicant. This may
be because my price lter is an imperfect screen for easily tradable stocks. However, it also
suggests that post bad-news-drift is a robust phenomenon.

## 4.4.7 Subperiod Analysis

It is possible that any investor underreaction has been reduced in recent years with the advent
of new and diverse sources of nancial information. It is also possible that broadening stock
market investment has changed any reaction that was present in the 1980s. I split my sample
into two subperiods. Table 8 shows 3-factor alphas for 1980-1989 (on the left) and 1990-1999
(on the right). Long-short, winner, and loser strategy results are in Panels A, B, and C,
respectively. Few stocks survive for two or more years within each ten-year period. Long-run
statistical inference is therefore dicult, so I do not show returns beyond 12 months. I also use
3-factor regressions rather than size and B/M adjusted returns because the matching criteria
43
for CRSP and Compustat data may eliminate too many stocks from each subperiod.

<sup>43</sup>
This also means, however, that I cannot skip a week before investment to control for microstructure eects,
since I do not have weekly Fama-French 3-factor data.

---

drift in the more recent years for the news set. The dierence in cumulative alphas between the
two periods may be attributed to the 3-factor regression, which ts the returns better in the
1980s. The R-squareds for the month-by-month regressions average about 0.8 for 1980-1989,
and 0.6 for 1990-1999. This may mean that the 3-factor model is less well specied in the latter
period. However, the general patterns of relative magnitudes and signs are more important
than the point estimates of alphas. The dierence between news and no-news set returns is
consistent for both periods. For both winner and losers, in both decades, the same general
patterns hold. There is pronounced reversal for no-news stocks, and evidence of drift in news
stocks, mostly for the losers. I conclude that although underreaction may have diminished in
recent years, it is still present. There is also some evidence of overreaction in the reversals of
the rst month.

## 4.5 Risk Changes Caused by News

As mentioned before, researchers have examined the possibility that risk changes are responsible
for predictable patterns in stock prices. Brown, Harlow, and Tinic (1993) look at how volatility
and beta change after large daily price movements. They conclude that stocks with negative

shocks. Thus bad news drives up expected future returns. However, this does not explain

paradox, in reverse, holds for winners.

In my analysis of cumulative alphas, I have already accounted for changes in known \risk"
factors, and still found statistically signicant drift for news stocks and reversal for no-news
stocks. However, it is interesting to see if news changes a stock’s risk. Table 9 shows the
evolution of month-by-month 3-factor loadings for winner and loser portfolios, news and nonews sets. These loadings are from the time series regressions described in the previous section.
44
At *t*= 0, news and no-news sets are similar. All losers are small, and winners even smaller.
Winners also have higher betas than losers. One can see that news losers do become more risky
in some sense. Betas rise, and they move more in tandem with smaller stocks. No-news losers
<sup>44</sup>
SMB weightings for winners and losers correspond to those for Fama and French’s smallest and next smallest

<sup>44</sup>
SMB weightings for winners and losers correspond to those for Fama and French’s smallest and next smallest
size quintile portfolios, respectively. See Fama and French (1993), Table 6.

---

also become more exposed to SMB. The opposite pattern is evident for the winners, which by
and large are growth stocks (negative exposure to HML) that attain lower betas and exposure
to SMB over time.

Finally, one can see that the 3-factor model does a good job of describing returns. Rsquared statistics for my portfolios are around 0.7 to 0.8, although other diversied portfolios
like mutual funds average R-squareds of about 0.8 or more. This reinforces the impression that
the abnormal returns I have found are not due to changes in risk. Loser and winner stocks tend
to become more and less risky, respectively, which is the opposite of what one would expect
from observing the drift patterns.

## 4.6 When Does Drift Occur?

The results shown above indicate that smaller stocks seem to underreact to bad news. Why
might this be the case? Researchers have oered two explanations, which are not necessarily
mutually exclusive. The rst is that investors simply have dierential attitudes to good and bad
news. They may consistently underreact to bad news, but have a dierent response for positive
signals. Another explanation would be that transactional frictions prevent some information,
particularly bad news, from being impounded into the stock price. Arbitrageurs would have
more diculty in taking positions and forcing stock price movements. The frictions would most
likely take the form of short sales constraints, since other costs such as bid-ask spreads or noise
trader risk and \limits of arbitrage" arguments cannot explain an asymmetric drift pattern
(although they may provide justication for the existence of anomalies in general). Note that
short sales constraints may explain the persistence of drift, but probably not why it exists in
the rst place. Few investors would wait several months to achieve a predictable 4-7% loss. For
most holders of stocks with bad news, it makes more sense to sell sooner, during shortly after
the headlines are public.

One way to examine these stories would be to look at how much of the news drift occurs on
months with subsequent news. This is similar to the analysis of La Porta, Lakonishok, Shleifer,
and Vishny (1997) (LLSV), who show that the market appears to be positively surprised by
the earnings or value stocks, and often disappointed by the earnings of growth stocks (i.e.

---

(as the post-earnings drift literature would suggest), then one might expect to see that most
post-bad-news drift comes in months with headlines. The news in those months would tend to
conrm the information released in the event month. Alternatively, if investors face diculty in
selling their stock, one might expect to see proportionally more post-bad-news drift in months
without headlines. In this case, investors must liquidate positions over an extended period of
time to reduce transactions costs. If the main cost makes it dicult to short-sell, there will be
less extended drift for news winners than for news losers in non-headline months.

There are numerous other possibilities, but these two simple alternatives seem to be the
most likely, given the patterns documented above. I observe the size and B/M adjusted returns
to the news long-short strategy over the subsequent 12 months that are solely attributed to
stocks that had headlines. Mechanically, I take the strategy returns from Table 6 and zero
out all of the returns for stocks in any month after *t*0 that did not have a headline. I repeat
the procedure for stocks in subsequent months that did have headlines to get the cumulative
returns attributable to stocks without news. Of course, the sum of the two sets of cumulative
returns will equal the results of Table 6. Note that this methodology decomposes a trading
strategy, but the resulting cumulative returns are not prots to two separate trading strategies
45
themselves. It is impossible to tell which months will have a headline ahead of time.

The results for the winner leg of the long-short strategy (Panel B) are harder to interpret.
News winners continue to rise in subsequent months that had news. Yet this \news surprise"
is almost entirely cancelled out by the negative returns in no-news months. This results in
the small magnitude CARs for news winners that we observed earlier. One could tell many
<sup>45</sup>
Earnings announcements, however, are an exception since the are planned in advance.

<sup>45</sup>
Earnings announcements, however, are an exception since the are planned in advance.

---

stories to explain this pattern. For instance, investors may expect subsequent conrmatory
news after a positive headline, but are disappointed when none occurs. Or some investors react
strongly to good news when it is announced, but others sell after run-ups (implying some sort
of overreaction). However, none of these is as simple as the underreaction to trading frictions
46
hypothesis, so it is dicult to characterize the news winner pattern.

In sum, I nd some signs that frictions increase bad news drift by slowing the incorporation
of information into prices. The pattern of returns on headline and no-headline months for news
winners implies a more complicated story, however. Finally, note that stocks tend to go up
when there is news, and go down when there is none. This seems logical given that uncertainty
causes prices to be discounted, and the resolution of uncertainty would reduce this.

## 5 Conclusion

I have examined various views of investor reaction to news in an integrated framework. I have
used a comprehensive sample of headlines for a large, randomly selected group of rms to test
the hypothesis that stocks exhibit no abnormal return after public news. I nd that this is not
the case. Instead stocks that experienced negative returns concurrent with the incidence of a
news story continued to underperform their size, book-to-market, and event return matched
peers. Stocks that experienced good news show less drift. On the other hand, extreme return
stocks that had no news headlines for a given month experienced reversal in the subsequent
month and little abnormal performance after that. The post-event drift is mainly after bad
news and is very robust. The conclusion of overreaction is somewhat weaker, since liquidity
eects may drive the reversal of returns. However, the reversal continues to appear when one
waits a week to pursue a no-news long-short strategy. One could argue that one week is enough
time for prices to return to equilibrium after a large, non-news motivated trade. Any pattern
after that is more likely to be caused by something else. Ranking by idiosyncratic risk does not
eliminate these results. Neither does weighting by number of news stories or excluding earnings

<sup>46</sup>
Repeating the LLSV earnings drift analysis on my news strategy shows that about 20% of the post-news drift
comes from earnings surprise. Again, most loser drift comes during months without earnings announcements,
and most winner drift comes from months with earnings announcements. Therefore earnings surprise drives
whatever news winner drift exists. This reinforces the earlier nding that investors do not underreact to good
news, except for positive earnings surprises. But this does not resolve the question of why investors would
be \serially surprised" by good (earnings) news, and sell stocks with good news in later months that had no
headlines.

---

announcements (which had previously shown drift). Buy-and-hold abnormal returns display
the same pattern of news drift and rst month no-news reversal. Drift patterns do become less
evident when weighting by *t*0 market valuation, implying that underreaction is mostly conned
to small stocks. They also seem stronger for low-priced stocks, although the results hold for
higher-priced stocks, too. There is also evidence that the relations are less strong, but still
economically signicant, in more recent years.

These results seem to conrm some assumptions of the DHS model of investor behavior
or the HS model of two classes of investors. Investors appear to underreact to public signals
and overreact to perceived private signals. The stronger nding is for the news stocks. Very
negative returns coupled with headlines seem to predict continued underperformance for up to
twelve months. This result is more understandable if one considers the existence of dierent
classes of investors. Most of the drift is on the downside among smaller, probably illiquid stocks.
More sophisticated investors may not be able to arbitrage away the pattern, since shorting is
more expensive than buying. This is supported by the fact that most negative drift happens
over many months without new information in the press. Perhaps individual investors are more
likely own more illiquid stocks. If individual investors exhibit psychological biases (which they
seem to), then the drift pattern might naturally arise because of their behavior.

There are other areas of potential future research. First, how correlated is news across
winner and loser sets? Grinblatt and Moskowitz (1999) nd that most momentum is industry
related. They hypothesize that 1-month industry momentum is due to an intra-industry leadlag eect. While it is possible that my results include some lead-lag eects, I condition on
public news, a signal that is more direct than a cross-correlation. However, it is probable that
news is related across rms. The interaction of cross-rm correlations with news is another
avenue of research. Second, who invests in stocks with drift? Investor segmentation may
explain some of my results. It seems likely that more sophisticated investors would avoid the
news loser stocks, and therefore information reaction would be muted. Are the remaining
stockholders individuals, who exhibit psychological biases in their investing strategies? Third,
it seems that short sales are very important. How critical are transactions costs in eliminating
some behavioral or clientele eects, and promoting others? Answering these questions, and
exploring other anomalies through the news/no-news lens, should sharpen our understanding
of the critical function of asset prices in transmitting information.

---

## References

Abarbanell, Jeery S., and Victor Bernard, 1992, Tests of analysts’ overreaction / underreaction
to earnings information as an explanation for anomalous stock price behavior, *Journal of*
*Finance* 47, 1181{1207.
Agrawal, Anup, Jeery F. Jae, and Gershon Mandelker, 1992, The post-merger performance
of acquiring rms in acquisitions: A re-examination of an anomaly, *Journal of Finance* 47,
1605{1621.
Barber, Brad, and Terrance Odean, 2000, Trading is hazardous to your wealth: The common
stock investment performance of individual investors, *Journal of Finance* 55, 773{806.
Barber, Brad M., and John D. Lyon, 1997, Detecting long-run abnormal stocks returns: The
empirical power and specication of test statistics, *Journal of Financial Economics* 43, 341{
72.
Barberis, Nicholas, Andrei Shleifer, and Robert Vishny, 1998, A model of investor sentiment,
*Journal of Financial Economics* 49, 307{43.
Bernard, Victor L., and Jacob K. Thomas, 1990, Evidence that stock prices do not fully reect
the implications of current earnings for future earnings, *Journal of Accounting and Economics*
13, 305{340.
Brown, Keith C., W. V. Harlow, and Seha M. Tinic, 1993, The risk and required return
of common stock following major price innovations, *Journal of Financial and Quantitative*
*Analysis* 28, 101{16.
Chan, Louis K.C., Narasimhan Jegadeesh, and Josef Lakonishok, 1996, Momentum strategies,
*Journal of Finance* 51, 1681{1714.
Conrad, Jennifer, and Gautham Kaul, 1998, An anatomy of trading strategies, *Review of*
*Financial Studies* 11, 489{519.
Cutler, David M., James M. Poterba, and Lawrence H. Summers, 1989, What moves stock
prices?, *Journal of Portfolio Management* 15, 4{12.
Daniel, Kent D., David Hirshleifer, and Avanidhar Subrahmanyam, 1998, Investor psychology
and security market under- and over-reactions, *Journal of Finance* 53, 1839{85.
Daniel, Kent D., and Sheridan Titman, 1997, Evidence on the characteristics of cross-sectional
variation in common stock returns, *Journal of Finance* 52, 1{33.
DeBondt, Werner F. M., and Richard H. Thaler, 1985, Does the stock market overreact?,
*Journal of Finance* 40, 793{808.
Dharan, Bala G., and David Ikenberry, 1995, The long-run negative drift of post-listing stock
returns, *Journal of Finance* 50, 1547{1574.
Fama, Eugene F., 1998, Market eciency, long-term returns and behavioral nance, *Journal*
*of Financial Economics* 49, 56{63.

---

*REFERENCES* 34
, and Kenneth R. French, 1992, The cross-section of expected stock returns, *Journal of*
*Finance* 47, 427{465.
, 1993, Common risk factors in the returns on stocks and bonds, *Journal of Financial*
*Economics* 33, 3{56.
French, Kenneth R., and Richard W. Roll, 1986, Stock return variance: The arrival of information and the reaction of traders, *Journal of Financial Economics* 19, 3{30.
Gompers, Paul, and Josh Lerner, 1998, Venture capital distributions: Short-run and long-run
reactions, *Journal of Finance* 53, 2161{83.
Grinblatt, Mark, and Tobias J. Moskowitz, 1999, Do industries explain momentum?, *Journal*
*of Finance* 54, 1249{90.
Grinblatt, Mark, Sheridan Titman, and Russ Wermers, 1995, Momentum investment strategies,
portfolio performance, and herding: A study of mutual fund behavior, *American Economic*
*Review* 85, 1088{1105.
Grundy, Bruce D., and Spencer J. Martin, 1998, Understanding the nature of the risks and the
source of the rewards to momentum investing, Wharton Working Paper, May 1998.
Hong, Harrison, Terence Lim, and Jeremy Stein, 2000, Bad news travels slowly: Size, analyst
coverage, and the protability of momentum strategies, *Journal of Finance* 55, 265{95.
Hong, Harrison, and Jeremy Stein, 1999, A unied theory of underreaction, momentum trading
and overreaction in asset markets, *Journal of Finance* 54, 2143{84.
Ikenberry, David, and Josef Lakonishok, 1993, Corporate governance through the proxy contest:
Evidence and implications, *Journal of Business* 66, 405{35.
, and Theo Vermaelen, 1995, Market underreaction to open market share repurchases,
*Journal of Financial Economics* 39, 181{208.
Ikenberry, David L., and Sundaresh Ramnath, 2000, Underreaction, Rice University Working
Paper.
Jegadeesh, Narasimhan, and Sheridan Titman, 1993, Returns to buying winners and selling
losers: Implications for stock market eciency, *Journal of Finance* 48, 65{91.
Kothari, S. P., and Jerold B. Warner, 1997, Measuring long-horizon security price performance,
*Journal of Financial Economics* 43, 301{39.
La Porta, Rafael, Josef Lakonishok, Andrei Shleifer, and Robert W. Vishny, 1997, Good news
for value stocks: Further evidence on market eciency, *Journal of Finance* 52, 859{874.
Lee, Charles M. C., and Bhaskaran Swaminathan, 2000, Price momentum and trading volume,
*Journal of Finance,* forthcoming.
Lewellen, Jonathan, 2000, Momentum prots and the autocorrelation of returns, MIT Working
paper.

---

Lo, Andrew W., and A. Craig MacKinlay, 1990, When are contrarian prots due to stock
market overreaction?, *Review of Financial Studies* 3, 175{205.
Loughran, Tim, and Jay Ritter, 1995, The new issues puzzle, *The Journal of Finance* 50, 23{52.
Loughran, Tim, and Jay R. Ritter, 2000, Uniformly least powerful tests of market eciency,
*Journal of Financial Economics* 55, 361{89.
Michaely, Roni, Richard H. Thaler, and Kent L. Womack, 1995, Price reactions to dividend
initiations and omissions: Overreaction or drift?, *Journal of Finance* 50, 573{608.
Michaely, Roni, and Kent Womack, 1999, Conict of interest and the credibility of underwriter
analyst recommendations, *Review of Financial Studies* 12, 653{86.
Mitchell, Mark L., and J. Harold Mulherin, 1994, The impact of public information on the
stock market, *Journla of Finance* 49, 923{950.
Nofsinger, John R., and Richard W. Sias, 1999, Herding and feedback trading by institutional
and individual investors, *Journal of Finance* 54, 2263{95.
Richardson, Matthew, and James H. Stock, 1989, Drawing inferences from statistics based on
multiyear asset returns, *Journal of Financial Economics* 25, 323{348.
Ritter, Jay R., 1991, The long-run performance of initial public oerings, *Journal of Finance*
46, 3{27.
Roll, Richard W., 1983, On computing mean returns and the small rm premium, *Journal of*
*Financial Economics* 12, 371{86.
, 1988, *R²*, *Journal of Finance* 43, 541{566.
Rouwenhorst, K. Geert, 1998, International momentum strategies, *Journal of Finance* 53, 267{
284.
Seyhun, H. Nejat, 1997, *Investment Intelligence: Tips from Insider Trading* (MIT Press: Cambridge).
Shiller, Robert J., 1981, Do stock prices move too much to be justied by subsequent changes
in dividends?, *American Economic Review* 71, 421{498.

---

Table 1: Summary of News Observations in Analysis, Selected Months

This table shows the number of observations in my subsample of CRSP stocks, for each December. Panel A shows numbers of stocks by days of headlines, and for "winner" and "loser" portfolios for three groups: "all", "news", and "no-news", which denote all stocks in the subset, those that had a headline, and those that did not in the event month. Panel B shows the time-series averages of monthly Pearson cross-sectional correlations between number of days with news and ending market values, returns and turnover

| Year | Total Stocks | Stocks with No News | Stocks with News, By Days: |  |  | Losers, Number of Stocks |  |  | Winners, Number of Stocks |  |  |  |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Year | Total Stocks | Stocks with No News | 4 or Less | 5 or More | All | News | No-News | All | News | No-News | All | News |
| 1980 | 314 | 203 | 109 | 2 | 39 | 20 | 28 | 39 | 20 | 10 |  |  |
| 1981 | 368 | 261 | 103 | 4 | 41 | 20 | 19 | 41 | 20 | 24 |  |  |
| 1982 | 382 | 254 | 126 | 2 | 110 | 40 | 92 | 110 | 40 | 52 |  |  |
| 1983 | 471 | 308 | 161 | 2 | 151 | 54 | 103 | 151 | 54 | 89 |  |  |
| 1984 | 494 | 334 | 151 | 9 | 159 | 52 | 116 | 159 | 52 | 78 |  |  |
| 1985 | 510 | 330 | 166 | 14 | 165 | 60 | 145 | 165 | 59 | 68 |  |  |
| 1986 | 550 | 347 | 181 | 22 | 177 | 66 | 125 | 183 | 76 | 107 |  |  |
| 1987 | 565 | 383 | 170 | 12 | 184 | 62 | 204 | 184 | 60 | 75 |  |  |
| 1988 | 558 | 383 | 166 | 9 | 179 | 76 | 196 | 181 | 57 | 116 |  |  |
| 1989 | 545 | 361 | 174 | 10 | 177 | 61 | 106 | 177 | 61 | 81 |  |  |
| 1990 | 537 | 334 | 195 | 8 | 177 | 67 | 119 | 176 | 67 | 95 |  |  |
| 1991 | 535 | 286 | 234 | 15 | 175 | 83 | 107 | 175 | 83 | 76 |  |  |
| 1992 | 546 | 289 | 233 | 24 | 177 | 97 | 133 | 177 | 84 | 86 |  |  |
| 1993 | 594 | 315 | 253 | 26 | 195 | 92 | 129 | 195 | 92 | 91 |  |  |
| 1994 | 635 | 532 | 92 | 11 | 206 | 33 | 231 | 206 | 33 | 148 |  |  |
| 1995 | 646 | 300 | 312 | 34 | 213 | 114 | 108 | 213 | 114 | 87 |  |  |
| 1996 | 690 | 319 | 341 | 30 | 227 | 122 | 106 | 227 | 122 | 87 |  |  |
| 1997 | 690 | 267 | 366 | 57 | 225 | 138 | 88 | 225 | 138 | 85 |  |  |
| 1998 | 647 | 232 | 344 | 71 | 211 | 135 | 87 | 211 | 135 | 54 |  |  |
| 1999 | 598 | 225 | 313 | 60 | 195 | 121 | 99 | 195 | 121 | 38 |  |  |

| Time Series | Market Value | Returns | Turnover |
| --- | --- | --- | --- |
| Average | 0.42 | 0.01 | 0.15 |
| Standard deviation | 0.07 | 0.01 | 0.11 |
| Maximum | 0.57 | 0.24 | 0.55 |
| Minimum | 0.18 | -0.26 | -0.11 |

B: Cross-Sectional Correlations of Number of Headline Days/Month w

---

Table 2: Summary Statistics of Winner and Loser Portfolios, Selected Months

This table shows average month end market values and returns for "winner" and "loser" stocks. Only December values are shown in detail. "Winners" have returns within the month in the top third of all stocks in the subsample, and "losers" in the bottom third. "All" sets rank on all stocks, "news" stocks are selected from among those which had at least one headline in the given month, and "no-news" stocks are drawn from those with no headlines. I divide stocks by news and no-news incidence first, then by performance, to form portfolios. News and No-news winner and loser breakpoints are the same, based on the performance of the news set.

Average Market Value, Millions

Average Returns

| Year | Losers |  |  | Winners |  |  | Winners |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Year | All | News | No-News | All | News | No-News | All | News | No-News |  |  |  |
| 1980 | 89 | 214 | 51 | 483 | 403 | 236 | -0.12 | -0.10 | -0.12 | 0.07 | 0.09 | 0.09 |
| 1981 | 308 | 473 | 144 | 139 | 298 | 130 | -0.13 | -0.13 | -0.14 | 0.09 | 0.06 | 0.09 |
| 1982 | 102 | 255 | 72 | 220 | 438 | 53 | -0.14 | -0.10 | -0.13 | 0.16 | 0.18 | 0.19 |
| 1983 | 136 | 254 | 67 | 231 | 440 | 108 | -0.15 | -0.15 | -0.15 | 0.08 | 0.09 | 0.08 |
| 1984 | 61 | 138 | 25 | 208 | 232 | 94 | -0.13 | -0.10 | -0.13 | 0.13 | 0.15 | 0.15 |
| 1985 | 101 | 145 | 61 | 259 | 260 | 99 | -0.10 | -0.07 | -0.08 | 0.21 | 0.24 | 0.25 |
| 1986 | 93 | 185 | 53 | 225 | 364 | 125 | -0.16 | -0.16 | -0.15 | 0.09 | 0.12 | 0.06 |
| 1987 | 78 | 315 | 47 | 291 | 438 | 105 | -0.17 | -0.11 | -0.13 | 0.23 | 0.27 | 0.29 |
| 1988 | 118 | 335 | 78 | 193 | 320 | 125 | -0.12 | -0.07 | -0.08 | 0.17 | 0.16 | 0.18 |
| 1989 | 189 | 342 | 91 | 549 | 1,060 | 201 | -0.14 | -0.16 | -0.13 | 0.13 | 0.16 | 0.14 |
| 1990 | 65 | 145 | 32 | 310 | 412 | 148 | -0.20 | -0.20 | -0.19 | 0.17 | 0.17 | 0.18 |
| 1991 | 47 | 92 | 33 | 457 | 695 | 228 | -0.15 | -0.13 | -0.14 | 0.28 | 0.31 | 0.28 |
| 1992 | 214 | 293 | 200 | 372 | 583 | 175 | -0.12 | -0.09 | -0.09 | 0.21 | 0.23 | 0.21 |
| 1993 | 205 | 510 | 101 | 602 | 944 | 323 | -0.13 | -0.12 | -0.12 | 0.14 | 0.14 | 0.16 |
| 1994 | 108 | 521 | 100 | 540 | 2,132 | 241 | -0.16 | -0.13 | -0.14 | 0.13 | 0.14 | 0.14 |
| 1995 | 214 | 325 | 142 | 745 | 925 | 290 | -0.14 | -0.12 | -0.15 | 0.16 | 0.17 | 0.16 |
| 1996 | 732 | 1,315 | 175 | 539 | 629 | 156 | -0.16 | -0.16 | -0.16 | 0.14 | 0.17 | 0.13 |
| 1997 | 167 | 225 | 84 | 1,563 | 2,309 | 382 | -0.22 | -0.22 | -0.21 | 0.13 | 0.13 | 0.12 |
| 1998 | 577 | 830 | 131 | 1,028 | 1,323 | 417 | -0.20 | -0.20 | -0.18 | 0.27 | 0.30 | 0.27 |
| 1999 | 770 | 2,064 | 155 | 1,252 | 1,326 | 413 | -0.14 | -0.14 | -0.12 | 0.41 | 0.48 | 0.46 |
| Time Series Average | 269 | 442 | 117 | 438 | 630 | 177 | -0.13 | -0.13 | -0.13 | 0.17 | 0.18 | 0.18 |

$$
\overset{\tt}{\longrightarrow}
$$

$$
\frac{\Omega}{r}={\frac{\Omega}{r}}
$$

---

Table 3: News Details for Selected Stocks and Dates

| loser | 1983 | 1 | -4.90% | Buys 7.8% of Raymond International; in $12 million dispute; sells headquarters |
| --- | --- | --- | --- | --- |
| loser | 1983 | 2 | -5.16 | Lower yr. on yr. net; boosts stake in Raymond International |
| loser | 1984 | 2 | -16.67 | Loss; omits dividend |
| winner | 1984 | 3 | 20.00 | President resigns |
| winner | 1985 | 12 | 36.17 | Chairman proposes management buyout |
| loser | 1986 | 2 | -6.67 | Chairman withdraws buyout proposal |
| winner | 1986 | 4 | 20.00 | Wilshire Oil holds 6.5% stake in firm |
| loser | 1986 | 8 | -3.03 | Agrees to buy Payne &amp; Keller |
| winner | 1986 | 10 | 16.67 | Gets EPA contract |
| winner | 1986 | 11 | 8.57 | Loss; Wilshire Oil raises stake to 10.3% |
| loser | 1987 | 1 | 0.00 | Higher yr. on yr. net; names new President; signs Wyle Labs contract |
| winner | 1987 | 7 | 58.03 | Higher yr. on yr. net; to buy Santa Fe Southern Pacific construction unit |
| winner | 1987 | 10 | -6.14 | Completes purchase of Santa Fe Southern Pacific unit |

| loser | 1993 | 8 | -0.76 | Merrill Cuts To Neutral |
| --- | --- | --- | --- | --- |
| loser | 1993 | 9 | -9.93 | Says ShopKo net declined, plans cost cuts; starts new membership club |
| winner | 1993 | 12 | 8.61 | Higher yr. on yr. net; Vice Chmn. retires; to buy Sweet Life; Painwebber upgrades |
| loser | 1994 | 7 | -5.37 | Sweet Life unit helps sales, hurts net; issues debt; buys Hyper Shoppes for cash |
| winner | 1994 | 11 | 2.00 | Buys MD Food distribution facility |
| loser | 1995 | 1 | -2.56 | Restructuring; Smith Barney starts at neutral; in supply pact w/ John B. Sanfilippo |
| winner | 1995 | 2 | 9.41 | Reveals capital spending/expansion plans; names new directors |
| loser | 1995 | 4 | -1.40 | Reports year-end net |
| winner | 1995 | 5 | 8.47 | Unit opens first Irish Store; selects ACR as POS supplier |
| loser | 1995 | 8 | -2.86 | Opens midwest regional office |
| loser | 1996 | 9 | -2.22 | Higher yr. on yr. net; Goldman upgrades; ShopKo to merge with Phar-Mor |
| winner | 1996 | 10 | 8.18 | Phar-Mor/ShopKo gives shares; retains shares in related cos.; debt downgraded |
| winner | 1997 | 4 | 2.94 | Beats earnings expectations; ShopKo to halt merger, buy Super Valu stake; competitor leaves Columbus |
| winner | 1997 | 7 | 17.39 | Financial Chief resigns; ShopKo stake nets $350m; Lukoil to supply gas at stores |
| loser | 1997 | 9 | 0.00 | Higher yr. on yr. net; shareholder rights plan amended |
| winner | 1997 | 12 | 6.52 | Beats earnings expectations |

---

## Table 4: Cumulative Long-Short Returns (%), at Different Horizons.

This table shows the cumulative raw returns to buying 1 month past winners and shorting 1 month past losers over several holding periods. In each month from 1/1980-12/1999, all stocks within a subsample are ranked by their performance. Stocks in the top third and stocks in the bottom third are held in the same portfolio with positive and negative weight, respectively. This portfolio formation process is conducted on three sets of stocks: 1) an "All" subset of randomly selected CRSP database stocks, 2) a "News" group consisting of all stocks that had at least 1 news headline during the month, and 3) a "No-News" group of all stocks without a news headline for the month. The resulting long-short portfolios are then aggregated into larger portfolios with overlapping positions, to accurately calculate standard errors. Panel A shows the average returns and t-statistics after immediately investing after portfolio formation, and Panel B shows the results to waiting 1 week after formation before investing.

| Months after Portfolio Formation | All Stocks |  | News Stocks |  | No-News Stocks |  |
| --- | --- | --- | --- | --- | --- | --- |
| Months after Portfolio Formation | Average | T-stat | Average | T-stat | Average | T-stat |

Panel A: Immediate Investment After portfolio Formation

| 1 | -1.14% | -4.83 | -0.33% | -1.25 | -1.91% | -6.11 |
| --- | --- | --- | --- | --- | --- | --- |
| 3 | -0.49 | -1.05 | 1.03 | 2.08 | -1.94 | 7.00 |
| 6 | 0.30 | 0.37 | 2.92 | 3.72 | -2.21 | -2.38 |
| 9 | 1.12 | 1.05 | 4.16 | 3.92 | -1.90 | -1.62 |
| 12 | 2.16 | 1.74 | 5.55 | 4.50 | -1.34 | -0.98 |
| 24 | 0.61 | 0.28 | 4.41 | 2.06 | -3.64 | -1.59 |
| 36 | -2.49 | -0.81 | 0.59 | 0.19 | -6.43 | -2.16 |

Panel B: Waiting 1 Week After Portfolio Formation Before Investment

| 1 | -0.18% | -0.96 | 0.43% | 2.07 | -0.77% | -2.94 |
| --- | --- | --- | --- | --- | --- | --- |
| 3 | 0.47 | 1.16 | 1.78 | 3.98 | -0.81 | -1.52 |
| 6 | 1.28 | 1.74 | 3.69 | 5.10 | -1.05 | -1.21 |
| 9 | 2.12 | 2.13 | 4.93 | 4.91 | -0.70 | -0.63 |
| 12 | 3.18 | 2.71 | 6.32 | 5.39 | -0.12 | -0.09 |
| 24 | 1.59 | 0.74 | 5.15 | 2.47 | -2.56 | -1.15 |
| 36 | -1.41 | -0.47 | 1.40 | 0.45 | -5.22 | -1.79 |

---

Table 5: Cumulative 3-Factor Alphas (%)

## Table 5: Cumulative 3-Factor Alphas (%)

month past losers over several holding periods.  In each month from 1/1980-12/1999, all stocks within th

e
subsample are ranked by their performance.  Stocks in the top and bottom thirds are held in an equal-weighted portfolio with positive and negative weight, respectively.  This portfolio formation process is conducted on two sets of stocks:  1) a "News" subset consisting of all subset stocks that had at least 1 news headline during the month, and 2) a "No-News" subset of all stocks without a news headline for the month.  The resulting long-short portfolios are then aggregated into larger portfolios with overlapping positions, for purposes of accurately calculating standard errors.  Panel A shows the average returns and t-statistics to the long-short strategy for both sets, Panel B shows the results for winners, and Panel C shows the results for losers.

| Months After Portfolio Formation | News Stocks |  | No-News Stocks |  | Difference |  |
| --- | --- | --- | --- | --- | --- | --- |
| Months After Portfolio Formation | Alpha | T-stat | Alpha | T-stat | Alpha | T-stat |

**Panel A:  Long-Short Strategy**

| 1 | -0.22% | -0.79 | -1.79% | -5.52 | 1.48% | 4.26 |
| --- | --- | --- | --- | --- | --- | --- |
| 3 | 1.42 | 2.79 | -1.65 | -2.71 | 2.94 | 4.92 |
| 6 | 3.31 | 4.12 | -1.93 | -2.02 | 5.47 | 6.85 |
| 9 | 4.63 | 4.27 | -1.86 | -1.53 | 6.20 | 6.37 |
| 12 | 6.16 | 4.89 | -1.52 | -1.07 | 7.22 | 6.15 |
| 24 | 5.10 | 2.44 | -4.13 | -1.76 | 8.39 | 4.61 |
| 36 | 0.65 | 0.22 | -7.12 | -2.37 | 7.32 | 3.00 |

Panel B: Winner Portfolio

| formation date | 16.54% | 44.42 | 16.20% | 44.87 | 0.34% | 2.02 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | -0.41 | -2.50 | -0.98 | -4.72 | 0.67 | 6.23 |
| 3 | -0.29 | -0.75 | -1.13 | -2.43 | 1.22 | 6.72 |
| 6 | -0.69 | -1.01 | -1.46 | -1.71 | 1.62 | 7.50 |
| 9 | -0.80 | -0.82 | -1.54 | -1.22 | 1.72 | 6.52 |
| 12 | -0.69 | -0.52 | -1.19 | -0.68 | 0.74 | 5.71 |
| 24 | -3.45 | -1.33 | 0.04 | 0.01 | -2.77 | 3.41 |
| 36 | -5.82 | -1.47 | 1.22 | 0.23 | -5.18 | 1.90 |

Panel C: Loser Portfolio

| formation date | -14.24% | -68.43 | -14.07% | -75.53 | -0.17% | -1.58 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | -0.19 | -0.75 | 0.81 | 2.79 | -1.00 | -3.72 |
| 3 | -1.72 | -2.97 | 0.52 | 0.66 | -2.24 | -3.83 |
| 6 | -4.00 | -3.67 | 0.47 | 0.32 | -4.47 | -4.72 |
| 9 | -5.43 | -3.36 | 0.32 | 0.15 | -5.75 | -4.62 |
| 12 | -6.85 | -3.27 | 0.33 | 0.12 | -7.18 | -4.60 |
| 24 | -8.55 | -2.05 | 4.17 | 0.80 | -12.72 | -4.50 |
| 36 | -6.47 | -1.03 | 8.34 | 1.11 | -14.81 | -3.64 |

---

## Table 6: Cumulative Size & B/M Adjusted Returns (%), skipping 1st. Week

This table shows the cumulative size and B/M adjusted returns to buying 1 month past winners and shorting 1 month past losers. In each month from 1/1980-12/1999, all stocks within the subsample are ranked by returns. Stocks in the top and bottom thirds are held in an equal-weighted portfolio with positive and negative weight, respectively. Portfolios are formed for two sets of stocks: 1) a "News" subset consisting of all stocks that had at least 1 news headline during the month, and 2) a "No-News" subset of all stocks without a headline for the month. The resulting long-short portfolios are then aggregated into larger portfolios with overlapping positions, for purposes of accurately calculating standard errors. Panel A shows the average returns and t-statistics to the long-short strategy for both sets, Panel B shows the results for winners, and Panel C shows the results for losers.

| Months After Portfolio Formation | News Stocks |  | No-News Stocks |  | Difference |  |
| --- | --- | --- | --- | --- | --- | --- |
| Months After Portfolio Formation | Alpha | T-stat | Alpha | T-stat | Alpha | T-stat |
| Panel A: Long-Short Strategy |  |  |  |  |  |  |
| 1 | 0.12% | 0.59 | -1.25% | -4.47 | 1.36% | 4.32 |
| 3 | 1.09 | 2.58 | -1.78 | -3.42 | 2.87 | 5.14 |
| 6 | 2.62 | 4.02 | -1.82 | -2.17 | 4.44 | 5.46 |
| 9 | 3.95 | 4.53 | -1.89 | -1.78 | 5.84 | 5.99 |
| 12 | 4.95 | 4.70 | -1.59 | -1.28 | 6.54 | 5.43 |
| 24 | 4.54 | 2.51 | -2.95 | -1.54 | 7.49 | 3.89 |
| 36 | 1.15 | 0.42 | -4.90 | -1.91 | 6.06 | 2.29 |
| Panel B: Winner Portfolio |  |  |  |  |  |  |
| formation date | 16.14% | 46.21 | 16.34% | 44.35 | -0.19% | -0.72 |
| 1 | 0.09 | 0.78 | -0.60 | -3.29 | 0.69 | 3.25 |
| 3 | 0.34 | 1.13 | -0.87 | -2.48 | 1.21 | 2.89 |
| 6 | 0.64 | 1.18 | -0.55 | -0.91 | 1.19 | 1.69 |
| 9 | 1.08 | 1.47 | -0.22 | -0.25 | 1.30 | 1.43 |
| 12 | 1.70 | 1.74 | 0.73 | 0.65 | 0.97 | 0.82 |
| 24 | 1.92 | 1.07 | 3.45 | 1.52 | -1.53 | -0.69 |
| 36 | 4.88 | 1.52 | 9.19 | 2.58 | -4.30 | -1.32 |
| Panel C: Loser Portfolio |  |  |  |  |  |  |
| formation date | -13.53% | -68.98 | -13.72% | -76.05 | 0.19% | 1.56 |
| 1 | -0.02 | -0.13 | 0.65 | 3.53 | -0.67 | -2.81 |
| 3 | -0.76 | -1.95 | 0.91 | 1.84 | -1.66 | -3.17 |
| 6 | -1.98 | -2.88 | 1.27 | 1.39 | -3.26 | -3.67 |
| 9 | -2.86 | -2.80 | 1.68 | 1.31 | -4.54 | -3.80 |
| 12 | -3.25 | -2.45 | 2.32 | 1.41 | -5.57 | -3.62 |
| 24 | -2.62 | -0.96 | 6.40 | 2.10 | -9.02 | -3.12 |
| 36 | 3.73 | 0.76 | 14.09 | 2.91 | -10.36 | -2.42 |

---

ed ($5 and under) stocks.

Difference

Months after Portfolio

ns after excluding earnings announcement stocks.

Panel E shows strategy returns after value weighting portfolio stocks. Panel F shows strategy returns after excluding low pric

nel B shows results using event-month abnormal

returns to rank stocks. Panel C shows results after weighting observations by days of headlines. Panel D shows strategy retur

ns, to accurately calculate standard errors. The first

week of returns is excluded from calculations. Panel A shows average returns and t-statistics for a Buy and Hold strategy. Pa

2) a "No-News" subset of all stocks without a
headline in the month. The resulting long-short portfolios are then aggregated into larger portfolios with overlapping positio

folio with positive and negative weight, respectively.

Portfolios are formed for: 1) a "News" subset consisting of all stocks that had at least 1 news headline during the month, and

r various sets of stocks. In each month, the

stocks in the set are ranked by their returns. Stocks in the top and bottom thirds ("winners" and "losers") are held in a port

This table shows cumulative size and B/M adjusted returns from buying 1 month past winners and shorting 1 month past losers, fo

Alpha

T-stat T-stat

**Table 7: Cumulative Long-Short Size and B/M Adjusted Returns (%), Skipping 1st Week, for Various Adjusted Sets**

T-stat T-stat T-stat T-stat

**Panel F: >$5 Stocks**

**Panel E: Value Weighting Stocks**

3.22
3.03
1.26
1.22
4.95
4.24 -0.43 -0.58
1.64
2.18
1.39
1.60
2.53
1.99
1.67
1.32
4.93
3.31 -0.44 -0.49
1.63
1.74
1.30
1.25
2.49
1.70
0.92
0.55
4.17
2.25 -0.64 -0.58
1.76
1.45
1.11
0.87
1.67
0.87 -0.46 -0.19
1.78
0.68 -0.79 -0.52
0.51
0.27 -0.51 -0.25
1.16 %
0.30 -0.94 % -0.21
0.52 %
0.09
1.02 %
0.37 -1.64 % -0.47 -0.44 % -0.11
4.68
6.65 -2.13 -2.70
3.13
3.95
5.43
6.99 -1.28 -1.59
4.65
5.40
5.10
5.75 -2.55 -2.79
2.82
2.96
6.00
6.25 -1.78 -1.89
4.49
4.36
4.11
3.75 -2.53 -2.25
1.85
1.49
6.03
5.15 -2.17 -1.82
4.53
3.33
3.54
2.39 -3.51 -1.93
0.80
0.46
5.48
3.14 -3.42 -1.78
3.01
1.37
3.35 %
1.17 -4.70 % -1.37 -0.72 % -0.20
4.87 %
1.60 -4.47 % -1.25
1.75 %
0.35
5.13
7.01 -1.43 -1.77
4.57
4.79
4.73
6.52 -1.22 -1.37
5.71
5.16
5.84
6.55 -2.12 -2.27
4.42
3.86
4.64
5.13 -0.80 -0.74
6.03
4.38
5.57
5.01 -2.35 -1.99
4.14
2.73
4.41
3.74 -1.20 -0.86
4.92
Alpha

2.87
5.69
Alpha

3.54 -3.66 **Panel D: Excluding Earnings Announcement Stocks**
Alpha -1.94

2.81
Alpha

1.21
4.35
2.55 -2.87 -1.34
2.87
1.20
*TABLES AND FIGURES* 3

4.64
**Panel B: Using Event Month Size and B/M Adjusted Returns** Alpha % Difference

1.60 -4.97 %
No-News Set -1.37

0.65 %
News Set

0.13
**Panel A: Buy and Hold Returns (BHARS)**

1.36 %
1.36 -4.47 %
No-News Set **Panel C: Weighted by Days of Headlines** -1.25

0.59 %
News Set

0.12
Formation

---

Difference

**Table 8: Cumulative 3 Factor Alphas (%), for Subperiods 1980-1989 and 1990-1999**

long-short strategy, Panel B shows the results for the winners, and Panel C shows the results for the losers.

aggregated into larger portfolios with overlapping positions, for purposes of accurately calculating standard errors. Panel A shows the average returns and t-statistics for the

stocks that had at least 1 news headline during the month, and 2) a "No-News" subset of all stocks without a headline for the month. The resulting long-short portfolios are then

("winners" and "losers") are held in an equal-weighted portfolio with positive and negative weight, respectively. Portfolios are formed for: 1) a "News" subset consisting of all

side are results from 1990-1999. In each month of both subperiods, all stocks within the subsample are ranked by their performance. Stocks in the top and bottom thirds

-3.99

-9.49

1.48
6.78
-3.96 -0.76

-7.45 -2.71

1.49 -2.65
5.38
-3.38 -6.08 -0.75

-4.82 -1.61 -2.07

1.56
This table shows the cumulative 3-factor alphas from buying 1 month past winners and shorting 1 month past losers. On the left are results from 1980-1989, and on the right-5.65

-2.67

3.83 -4.44
-2.43 -4.82 -0.56

-11.72 -2.16 -1.91 -0.99

1.63 -5.06 -3.22
2.14 -4.93
-2.50 -4.23 -0.02 % -9.88

-1.05 -1.66 -0.02

2.95 -3.00 % -3.25
1.44 -5.30 -2.57
0.64
0.97 -7.23 % -0.92
1.28
0.39 -0.89
0.81
-3.01 -5.01

2.32
%

1.80
-1.02

1.21-3.46
2.60
0.60
2.68
%

0.29
0.19
0.01
0.58
1.94
-2.75

0.02
0.77
%

2.21
-0.83

1.23-1.40
0.08 -3.35
0.100.58
2.33 -2.20
0.740.75
1.57 -3.59
0.77 -1.64
-0.68

-2.91

1.18
-0.46

2.54 -2.00 % 0.901.18
0.83 -2.55
0.54-2.15
-2.31

-2.60 %

1.97
-0.68 -2.19

1.16
5.52
-1.11 -2.03 % -2.42

9.01
-0.24

-1.63 -1.94

1.38 -1.83
-4.51 %

5.17
Alpha

0.49 -0.94
2.64
T-stat

7.13
T-stat -3.88

5.28
% -2.39 Alpha

-1.14

-4.812.58 T-stat 5.15 -2.35

1.914.47
%

6.15
Alpha -0.59

3.261.21
-2.29

2.30
-3.68

2.69
3.44
4.43
1.48
3.75
2.95
8.14
1.79
1.38
-2.52 Alpha

2.15
-2.55

3.62
Alpha

3.24
T-stat 4.80 % **Panel A: Long-Short Cumulative 3 Factor Alphas**

0.78
Alpha 4.20

1.64
7.33
0.60
0.34
T-stat-3.92

%

0.40
*TABLES AND FIGURES*

3.77
-2.13

4.52
T-stat

3.29
-1.56

5.20
**Panel B: Winner Cumulative 3 Factor Alphas** % -1.00 **1990-1999** -0.63 6 No-News Set -0.73

2.56
3.58
News Set %

1.26
2.52
-3.66 3 Difference Formation No-News Set % **Panel C: Losers Cumulative 3 Factor Alphas**

-1.33

**1980-1989** Months after Portfolio

0.65 %
News Set

0.24

---

| Table 9:3-Factor Exposures for News/No-News Winner and Loser Portfolios, Selected Months after Formation |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Months after Formation | Market-Rf Coefficient |  | SMB Coefficient |  | HTML Coefficient |  | R-squared |  | Market-Rf Coefficient |  | SMB Coefficient |  | HTML Coefficient |  |  |
| Months after Formation | T-stat | T-stat | T-stat | Coefficient | T-stat | Coefficient | T-stat | R-squared | T-stat | Coefficient | T-stat | Coefficient | T-stat | R-squared |  |
|  | News |  |  |  |  |  |  |  | No-News |  |  |  |  |  |  |
| 0 | 0.98 | 18.24 | 0.95 | 12.08 | 0.38 | 4.43 | 0.72 |  | 0.93 | 19.31 | 0.96 | 13.52 | 0.33 | 4.25 | 0.75 |
| 1 | 1.13 | 17.26 | 1.16 | 12.06 | 0.16 | 1.43 | 0.73 |  | 0.98 | 13.03 | 1.22 | 11.04 | 0.20 | 1.64 | 0.63 |
| 3 | 1.09 | 18.37 | 1.07 | 12.65 | 0.17 | 1.83 | 0.75 |  | 0.94 | 12.04 | 1.25 | 11.20 | 0.31 | 2.50 | 0.60 |
| 6 | 1.04 | 17.30 | 1.19 | 13.73 | 0.30 | 3.18 | 0.73 |  | 1.02 | 12.91 | 1.19 | 10.54 | 0.32 | 2.55 | 0.61 |
| 9 | 1.03 | 18.53 | 1.15 | 14.33 | 0.17 | 1.87 | 0.77 |  | 0.92 | 11.88 | 1.34 | 12.09 | 0.30 | 2.41 | 0.61 |
| 12 | 1.00 | 17.63 | 1.13 | 13.78 | 0.08 | 0.88 | 0.76 |  | 0.89 | 13.41 | 1.10 | 11.35 | 0.21 | 1.91 | 0.65 |
| 24 | 1.08 | 18.78 | 1.22 | 14.43 | 0.29 | 3.09 | 0.77 |  | 0.92 | 14.46 | 1.08 | 11.62 | 0.18 | 1.73 | 0.68 |
| 36 | 1.05 | 16.64 | 1.20 | 13.22 | 0.22 | 2.10 | 0.75 |  | 0.87 | 13.37 | 1.21 | 12.95 | 0.20 | 1.93 | 0.69 |
|  | News |  |  |  |  |  |  |  | Winners |  |  |  |  |  |  |
| 0 | 1.16 | 12.05 | 1.47 | 10.38 | -0.25 | -1.61 | 0.65 |  | 1.30 | 13.92 | 1.30 | 9.52 | -0.07 | -0.44 | 0.66 |
| 1 | 1.00 | 23.65 | 1.04 | 16.81 | 0.10 | 1.45 | 0.84 |  | 0.83 | 15.47 | 1.09 | 13.78 | 0.14 | 1.62 | 0.72 |
| 3 | 1.02 | 22.21 | 1.07 | 16.09 | 0.05 | 0.63 | 0.83 |  | 0.89 | 16.40 | 1.18 | 15.02 | 0.16 | 1.86 | 0.74 |
| 6 | 1.06 | 25.46 | 0.95 | 15.88 | 0.00 | 0.01 | 0.86 |  | 0.88 | 16.96 | 1.09 | 14.71 | 0.09 | 1.15 | 0.76 |
| 9 | 1.04 | 22.64 | 1.00 | 15.13 | 0.19 | 2.63 | 0.82 |  | 1.00 | 18.54 | 0.97 | 12.43 | 0.24 | 2.76 | 0.74 |
| 12 | 1.05 | 22.28 | 0.97 | 14.16 | 0.07 | 0.92 | 0.82 |  | 0.94 | 16.77 | 1.10 | 13.50 | 0.32 | 3.51 | 0.72 |
| 24 | 1.08 | 20.52 | 0.86 | 11.16 | 0.25 | 2.83 | 0.77 |  | 0.90 | 13.47 | 1.23 | 12.54 | 0.33 | 3.00 | 0.66 |
| 36 | 1.11 | 20.72 | 0.91 | 11.70 | 0.29 | 3.28 | 0.78 |  | 0.87 | 14.46 | 0.91 | 10.54 | 0.23 | 2.40 | 0.67 |

---

Table 10: Breakdown of News Stock Returns in post-Event Months by News Month or No-News Month returns, skipping 1st Week

This table shows the cumulative size and B/M adjusted returns to buying 1 month past "news" winners and shorting 1 month past "news" losers. The cumulative payoffs to the news strategy are divided into returns that 1) would accrue had only stocks with news in each subsequent month been held, and 2) returns from holding only those strategy stocks which had no news in each subsequent month. The resulting portfolios consist of overlapping positions, for purposes of accurately calculating standard errors. For the long-short strategy, stocks in the top and bottom thirds are held in an equal-weighted portfolio with positive and negative weight, respectively. Panel A shows the average returns and t-statistics to the long-short strategy for both sets, Panel B shows the results for winners, and Panel C shows the results for losers.

| Months After Portfolio Formation | Counting only stocks with: |  |  |  |
| --- | --- | --- | --- | --- |
| Months After Portfolio Formation | News in Month |  | No News in Month |  |
|  | Alpha | T-stat | Alpha | T-stat |
| Panel A：Long-Short Strategy |  |  |  |  |
| 1 | -0.01% | -0.09 | 0.13% | 1.24 |
| 3 | 0.55 | 1.65 | 0.55 | 2.46 |
| 6 | 1.61 | 3.02 | 1.01 | 2.89 |
| 9 | 2.09 | 3.02 | 1.86 | 3.95 |
| 12 | 2.86 | 3.42 | 2.10 | 3.61 |
| Panel B：Winner Portfolio |  |  |  |  |
| 1 | 0.22% | 2.19 | -0.12% | -1.69 |
| 3 | 0.84 | 3.25 | -0.50 | -3.18 |
| 6 | 1.77 | 3.91 | -1.14 | -4.28 |
| 9 | 2.69 | 4.20 | -1.61 | -4.27 |
| 12 | 3.89 | 4.45 | -2.18 | -4.57 |
| Panel C：Loser Portfolio |  |  |  |  |
| 1 | 0.23% | 1.72 | -0.25% | -2.86 |
| 3 | 0.30 | 0.96 | -1.05 | -5.46 |
| 6 | 0.16 | 0.28 | -2.14 | -6.12 |
| 9 | 0.60 | 0.69 | -3.46 | -6.86 |
| 12 | 1.03 | 0.91 | -4.28 | -6.55 |