## Pipeline

---

Pipelines are used to transform Pond data. They allow a chain of operations to be applied to streaming Events, Collections or TimeSeries.

A general Pipeline has a source (`from(source)`), a chain of Processors, and a destination (`to(dest)`). Events pass through the Pipeline, read from the source, processed one by one, and output to the destination. The source my be bounded, such as a TimeSeries or Collection, or unbounded where events arrive as a stream and are added to the Pipeline one by one.

Pipelines can also define a set of state that applies within all or part of the chain.

This state maybe a combination of:
 * windows, such as a 5 minute collection window
 * groups, such as the type of the Event
  
These states would be applied where appropriate, for example, when aggregating.

### Example

Let's look at what that looks like. Imagine we have a collection of Events and each event has a timestamp along with an "in" and "out" value, such as we have with network traffic data.

We then want to offset the "in" value of each event by 1, and then by 2.

    Pipeline()
        .from(collection)   // From the source collection
        .offsetBy(1, "in")  // Process each event in the collection
        .offsetBy(2)        // Process again
        .to(Collector, {}, c => /* result */ ); // Output to new Collection

In this case, we use the from() operation to specify a Collection to take data from. Since a Collection is a bounded data source, the operation will be performed in batch. That is, all events in the collection will be piped though the transforms and the result collected at the end. This batching will happen when the Collector is added with the to() operation. As each event flows from the from collection to the end Collector, it is passed into the intermediate Processors. In this case it passes through two offsetBy Processors. Each of these is used to in some way process the event. In this case that means taking the input Event, changing a value (adding 1 to the "in" value), and outputting a new Event. As these are immutable objects, the output Events do not share data with the input Events.

This raises probably the most important part of how Pipelines work: they are foremost an event processing pipeline. Events are passed into each Processor (e.g. offsetBy) and the result is zero, one or many output events. Events are passed down the line of Processors until they reach a `to()`, which causes some kind of output (which could be a stream of Events, a Collection, or something else). This is distinct from systems which essentially transform between collection of items or micro-batch.

---

### Event streaming

As an event processing system, it makes sense that you can stream events though a pipeline. In this example we create a simple UnboundedIn. This forms a target for adding events. A Pipeline similar to the above examples follows. As each event is added to the source, those events flow into the Pipeline and are collected at the bottom.

    const source = new UnboundedIn();
    Pipeline()
        .from(source)
        .offsetBy(3, "in")
        .to(Collector, {}, c => out = c);

    // Start adding events...
    source.addEvent(e1);
    source.addEvent(e2);

Note that in this case the Collection will be updated each time new data appears, and that Collection is global (i.e. not windowed). It is possible to change how often the collection is updated, as well as provide windowing to output collections per window, or per window per groupedBy key.

It is also possible to derive a class from UnboundedIn() that can produce Events itself, for instance if your events are coming from a Pubsub subscription.

---
### Aggregation

A common use-case for Pipelines is aggregation. Aggregation is performed on windowed (and grouped) events. There must currently be a window defined for a Pipeline to aggregate.

Here is a simple example:

    const input = new UnboundedIn();
    const result = {};

    const p = Pipeline()
        .from(input)
        .windowBy("1h")           // 1 day fixed windows
        .emitOn("eachEvent")    // emit result on each event
        .aggregate({in: avg, out: avg})
        .to(EventOut, {}, event => {
            result[`${event.index()}`] = event;
        });

As in the streaming example above, we make an UnboundedIn onto which we add Events.

What's new here is the state that is being set in the Pipeline:
 * windowBy - sets windowing to be 1 hour
 * emitOn - sets the triggering of aggregation to be each time a new event comes in. This will mean the same output will be generated multiple times, each time with an updated aggregation. The alternative is "discard" which would only emit when an event moves into another window

Once this state is established the aggregate() processor can be used. The argument to this is a field specification that tells the emit code which fields of the collected window of events should be aggregated together and what function to use.

The output, an EventOut, will call the callback whenever a new aggregated event is emitted. Since the triggering (emitOn) is set to "eachEvent", it will be called multiple times. In this case we just re-add it, but the index, to our result map.

### Aggregation with grouping

Pipelines also support a groupBy() processor. In the following example each event has a field called "type". The result of this will be that aggregation collections will be further partitioned based on the group, in addition to the window.

    const input = new UnboundedIn();
    const result = {};

    const p = Pipeline()
        .from(input)
        .groupBy("type")
        .windowBy("1h")           // 1 day fixed windows
        .emitOn("eachEvent")      // emit result on each event
        .aggregate({type: keep, in: avg, out: avg}) // keep the type, avg the in and out
        .to(EventOut, {}, event => {
            result[`${event.index()}:${event.get("type")}`] = event;
        });

    eventsIn.forEach(event => input.addEvent(event));

During our aggregation, output IndexedEvents are formed with the average of "in", and the average of "out". The value of the "type" field is kept in the final result using the `keep` aggregation function.

In this case we simply want to collect the events. To do this we separate the output events using both the IndexEvent's Index (which describes the windowed timerange of the event), joined with the value of the "type" field that we preserved in our aggregation.

---

### Conversions

There are three types of events in Pond: regular `Events`, which have a single timestamp, `TimeRangeEvents` which have a `TimeRange` (begin and end time) associated with them, and `IndexedEvents` which have a string that represents a time range. Sometimes it is helpful to convert between these Event types. To do this you can use the `asEvents()`, `asIndexedEvents()` and `asTimeRangeEvent()` processors.

Taking the first streaming example, we can convert the output IndexedEvents to a basic Event like so:

```
    const input = new UnboundedIn();
    const result = {};

    const p = Pipeline()
        .from(input)
        .windowBy("1h")           // 1 day fixed windows
        .emitOn("eachEvent")    // emit result on each event
        .aggregate({in: avg, out: avg})
        .asEvents()
        .to(EventOut, {}, event => {
            result[`${event.index()}`] = event;
        });
```

---
### Merging pipelines

Pipelines can themselves be chained together.

    const p1 = Pipeline()
        .from(collection)                  // This links to the src collection
        .offsetBy(1, "in")                 // Process each event
        .offsetBy(2)                       // Process again
        .to(Collector, {}, c => c1 = c);

    const p2 = p1
        .offsetBy(3, "in")                 // Transforms to a new collection
        .to(Collector, {}, c => c2 = c);   // Evokes the action to pass collection

In this example, the second pipeline will attach to the first pipeline. Currently batch pipelines support this, but only as a linear pipe. You cannot merge multiple bounded sources together. It is recommended that you do this manually by using, for example, Collection.combine() first, then running this through the Pipeline.

---
### TimeSeries pipelines

Pipelines can also be run directly off TimeSeries objects.

    const timeseries = new TimeSeries(data);
    timeseries.pipeline()
        .offsetBy(1, "in")
        .offsetBy(2)
        .to(Collector, {}, c => out = c);

---
## API Reference

A pipeline manages a processing chain, for either batch or stream processing
of collection data.

**Kind**: global class  

* [Pipeline](#Pipeline)
    * [new Pipeline([arg])](#new_Pipeline_new)
    * [.windowBy()](#Pipeline+windowBy) ⇒ <code>[Pipeline](#Pipeline)</code>
    * [.groupBy(k)](#Pipeline+groupBy) ⇒ <code>[Pipeline](#Pipeline)</code>
    * [.emitOn(trigger)](#Pipeline+emitOn) ⇒ <code>[Pipeline](#Pipeline)</code>
    * [.from(src)](#Pipeline+from) ⇒ <code>[Pipeline](#Pipeline)</code>
    * [.to()](#Pipeline+to) ⇒ <code>[Pipeline](#Pipeline)</code>
    * [.offsetBy(by, fieldSpec)](#Pipeline+offsetBy) ⇒ <code>[Pipeline](#Pipeline)</code>
    * [.aggregate(fields)](#Pipeline+aggregate) ⇒ <code>[Pipeline](#Pipeline)</code>
    * [.asEvents(options)](#Pipeline+asEvents) ⇒ <code>[Pipeline](#Pipeline)</code>
    * [.asTimeRangeEvents(options)](#Pipeline+asTimeRangeEvents) ⇒ <code>[Pipeline](#Pipeline)</code>
    * [.asIndexedEvents(options)](#Pipeline+asIndexedEvents) ⇒ <code>[Pipeline](#Pipeline)</code>

<a name="new_Pipeline_new"></a>

### new Pipeline([arg])
Build a new Pipeline.

**Params**

- [arg] <code>[Pipeline](#Pipeline)</code> | <code>Immutable.Map</code> | <code>null</code> - May be either:
 * a Pipeline (copy contructor)
 * an Immutable.Map, in which case the internal state of the
   Pipeline will be contructed from the Map
 * not specified

Usually you would initialize a Pipeline using the factory
function, rather than this object directly with `new`.

**Example**  
```
import { Pipeline } from "pondjs";
const process = Pipeline()...`
```
<a name="Pipeline+windowBy"></a>

### pipeline.windowBy() ⇒ <code>[Pipeline](#Pipeline)</code>
Set the window, returning a new Pipeline. The argument here
is an object with {type, duration}.
type may be:
 * "Fixed"
duration is of the form:
 * "30s", "5m" or "1d" etc

**Kind**: instance method of <code>[Pipeline](#Pipeline)</code>  
**Returns**: <code>[Pipeline](#Pipeline)</code> - The Pipeline  
<a name="Pipeline+groupBy"></a>

### pipeline.groupBy(k) ⇒ <code>[Pipeline](#Pipeline)</code>
Sets a new groupBy expression. Returns a new Pipeline.

Grouping is a state set on the Pipeline. Operations downstream
of the group specification will use that state. For example, an
aggregation would occur over any grouping specified.

**Kind**: instance method of <code>[Pipeline](#Pipeline)</code>  
**Returns**: <code>[Pipeline](#Pipeline)</code> - The Pipeline  
**Params**

- k <code>function</code> | <code>array</code> | <code>string</code> - The key to group by.
You can groupby using a function `(event) => return key`,
a fieldSpec (a field name, or dot delimitted path to a field),
or a array of fieldSpecs

<a name="Pipeline+emitOn"></a>

### pipeline.emitOn(trigger) ⇒ <code>[Pipeline](#Pipeline)</code>
Sets the condition under which accumulated collection will
be emitted. If specified before an aggregation this will control
when the resulting event will be emitted relative to the
window accumulation. Current options are to emit on every event
or just when the collection is complete.

**Kind**: instance method of <code>[Pipeline](#Pipeline)</code>  
**Returns**: <code>[Pipeline](#Pipeline)</code> - The Pipeline  
**Params**

- trigger <code>string</code> - A string indicating how to trigger a
Collection should be emitted. May be:
    * "eachEvent" - when a new event comes in, all currently
                    maintained collections will emit their result
    * "discard"   - when a collection is to be discarded,
                    first it will emit. But only then.

<a name="Pipeline+from"></a>

### pipeline.from(src) ⇒ <code>[Pipeline](#Pipeline)</code>
The "In" to get events from. The In needs to be able to
iterate its events using for..of loop for bounded Ins, or
be able to emit for unbounded Ins. The actual batch, or stream
connection occurs when an output is defined with to().

from() returns a new Pipeline.

**Kind**: instance method of <code>[Pipeline](#Pipeline)</code>  
**Returns**: <code>[Pipeline](#Pipeline)</code> - The Pipeline  
**Params**

- src <code>In</code> - The source for the Pipeline.

<a name="Pipeline+to"></a>

### pipeline.to() ⇒ <code>[Pipeline](#Pipeline)</code>
Sets up the destination sink for the pipeline. The output should
be a BatchOut subclass for a bounded input and a StreamOut subclass
for an unbounded input.

For a batch mode connection, the output is connected and then the
source input is iterated over to process all events into the pipeline and
down to the out.

For stream mode connections, the output is connected and from then on
any events added to the input will be processed down the pipeline to
the out.

**Kind**: instance method of <code>[Pipeline](#Pipeline)</code>  
**Returns**: <code>[Pipeline](#Pipeline)</code> - The Pipeline  
**Example**  
```
const p = Pipeline()
 ...
 .to(EventOut, {}, event => {
     result[`${event.index()}`] = event;
 });
```
<a name="Pipeline+offsetBy"></a>

### pipeline.offsetBy(by, fieldSpec) ⇒ <code>[Pipeline](#Pipeline)</code>
Processor to offset a set of fields by a value. Mostly used for
testing processor operations.

**Kind**: instance method of <code>[Pipeline](#Pipeline)</code>  
**Returns**: <code>[Pipeline](#Pipeline)</code> - The modified Pipeline  
**Params**

- by <code>number</code> - The amount to offset by
- fieldSpec <code>string</code> | <code>array</code> - The field(s)

<a name="Pipeline+aggregate"></a>

### pipeline.aggregate(fields) ⇒ <code>[Pipeline](#Pipeline)</code>
Uses the current Pipeline windowing and grouping
state to build collections of events and aggregate them.
`IndexedEvent`s will be emitted out of the aggregator based
on the `emitOn` state of the Pipeline.

To specify what part of the incoming events should
be aggregated together you specify a `fields`
object. This is a map from fieldName to operator.

**Kind**: instance method of <code>[Pipeline](#Pipeline)</code>  
**Returns**: <code>[Pipeline](#Pipeline)</code> - The Pipeline  
**Params**

- fields <code>object</code> - Fields and operators to be aggregated

**Example**  
```js
import { Pipeline, EventOut, functions } from "pondjs";
const { avg } = functions;

const p = Pipeline()
  .from(input)
  .windowBy("1h")           // 1 day fixed windows
  .emitOn("eachEvent")    // emit result on each event
  .aggregate({in: avg, out: avg})
  .asEvents()
  .to(EventOut, {}, event => {
     result[`${event.index()}`] = event;
  });
```
<a name="Pipeline+asEvents"></a>

### pipeline.asEvents(options) ⇒ <code>[Pipeline](#Pipeline)</code>
Converts incoming TimeRangeEvents or IndexedEvents to
Events. This is helpful since some processors will
emit TimeRangeEvents or IndexedEvents, which may be
unsuitable for some applications.

**Kind**: instance method of <code>[Pipeline](#Pipeline)</code>  
**Returns**: <code>[Pipeline](#Pipeline)</code> - The Pipeline  
**Params**

- options <code>object</code> - To convert to an Event you need
to convert a time range to a single time. There are three options:
 1. use the beginning time (options = {alignment: "lag"})
 2. use the center time (options = {alignment: "center"})
 3. use the end time (options = {alignment: "lead"})

<a name="Pipeline+asTimeRangeEvents"></a>

### pipeline.asTimeRangeEvents(options) ⇒ <code>[Pipeline](#Pipeline)</code>
Converts incoming Events or IndexedEvents to
TimeRangeEvents.

**Kind**: instance method of <code>[Pipeline](#Pipeline)</code>  
**Returns**: <code>[Pipeline](#Pipeline)</code> - The Pipeline  
**Params**

- options <code>object</code> - To convert from an Event you need
to convert a single time to a time range. To control this you
need to specify the duration of that time range, along with
the positioning (alignment) of the time range with respect to
the time stamp of the Event.

There are three option for alignment:
 1. time range will be in front of the timestamp (options = {alignment: "front"})
 2. time range will be centered on the timestamp (options = {alignment: "center"})
 3. time range will be positoned behind the timestamp (options = {alignment: "behind"})

The duration is of the form "1h" for one hour, "30s" for 30 seconds and so on.

<a name="Pipeline+asIndexedEvents"></a>

### pipeline.asIndexedEvents(options) ⇒ <code>[Pipeline](#Pipeline)</code>
Converts incoming Events to IndexedEvents.

Note: It isn't possible to convert TimeRangeEvents to IndexedEvents.

**Kind**: instance method of <code>[Pipeline](#Pipeline)</code>  
**Returns**: <code>[Pipeline](#Pipeline)</code> - The Pipeline  
**Params**

- options <code>Object</code> - An object containing the conversion
options. In this case the duration string of the Index is expected.
    - .duration <code>string</code> - The duration string is of the form "1h" for one hour, "30s"
for 30 seconds and so on.



